package controller

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/oauth"
	"github.com/QuantumNous/new-api/service"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
)

type joinWaitlistRequest struct {
	Email          string `json:"email" binding:"required,email"`
	ProviderName   string `json:"provider_name"`
	ProviderUserId string `json:"provider_user_id"`
}

// JoinWaitlist accepts an email-only waitlist signup. Creates a "waiting"
// entry and sends a confirmation email with the queue position. Always returns
// 200 (even if already on the list) to avoid leaking waitlist state.
//
// ProviderName/ProviderUserId are optionally supplied when a person was routed
// here from a full OAuth sign-up, carrying their OAuth identity for later
// re-binding at activation.
func JoinWaitlist(c *gin.Context) {
	var req joinWaitlistRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "邮箱格式无效 / invalid email"})
		return
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))

	var entry *model.WaitlistEntry
	var created bool
	var err error
	if req.ProviderName != "" && req.ProviderUserId != "" {
		entry, created, err = model.AddToWaitlistWithProvider(email, req.ProviderName, req.ProviderUserId)
	} else {
		entry, created, err = model.AddToWaitlist(email)
	}
	if err != nil {
		common.SysError("failed to add to waitlist: " + err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "failed to join waitlist"})
		return
	}
	position, _ := model.WaitlistPosition(email)
	if created {
		gopool.Go(func() {
			if err := service.SendWaitlistConfirmationEmail(email, position); err != nil {
				common.SysError("failed to send waitlist confirmation: " + err.Error())
			}
		})
	}
	status := "waiting"
	if entry != nil && !created {
		status = entry.Status
	}
	c.JSON(http.StatusOK, gin.H{
		"success":  true,
		"position": position,
		"status":   status,
		"message":  "您已加入候补名单 / You're on the waitlist",
	})
}

type waitlistStatusRequest struct {
	Email string `json:"email" binding:"required,email"`
}

// GetWaitlistStatus lets a person check their position by email.
func GetWaitlistStatus(c *gin.Context) {
	var req waitlistStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "邮箱格式无效 / invalid email"})
		return
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	position, _ := model.WaitlistPosition(email)
	status := "unknown"
	if entry, err := model.GetWaitlistEntryByEmail(email); err == nil && entry != nil {
		status = entry.Status
	}
	c.JSON(http.StatusOK, gin.H{
		"success":  true,
		"position": position,
		"status":   status,
	})
}

// ActivateByMagicLink consumes a promotion magic link. On success it creates
// the user account (with the supplied password) and seeds their dynamic quota
// at the floor. The frontend hits this with the token from the email link.
type activateRequest struct {
	Token    string `json:"token" binding:"required"`
	Username string `json:"username" binding:"required,min=3,max=20"`
	Password string `json:"password" binding:"required,min=8,max=20"`
}

func ActivateByMagicLink(c *gin.Context) {
	var req activateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求参数无效 / invalid request"})
		return
	}
	// ConsumeMagicToken atomically claims the token (promoted -> activating),
	// preventing concurrent double-activation. On any failure below we release
	// it back to "promoted" so the user can retry with a different username.
	entry, err := model.ConsumeMagicToken(req.Token)
	if err != nil {
		// Deliberately identical message for not-found vs expired vs already-used
		// to avoid leaking token state to a probing attacker.
		c.JSON(http.StatusForbidden, gin.H{
			"success": false,
			"message": "激活链接无效或已过期，请重新加入候补名单 / invalid or expired activation link",
		})
		return
	}
	email := entry.Email
	// Ensure username/email not taken.
	exist, err := model.CheckUserExistOrDeleted(req.Username, email)
	if err != nil {
		_ = model.ReleaseActivation(entry.Id)
		common.ApiError(c, err)
		return
	}
	if exist {
		// Reusable failure: release the claim so the user can retry.
		_ = model.ReleaseActivation(entry.Id)
		c.JSON(http.StatusConflict, gin.H{
			"success": false,
			"message": "用户名或邮箱已被占用 / username or email already taken",
		})
		return
	}
	cleanUser := model.User{
		Username:    req.Username,
		Password:    req.Password,
		DisplayName: req.Username,
		Email:       email,
		Role:        common.RoleCommonUser,
	}
	if err := cleanUser.Insert(0); err != nil {
		_ = model.ReleaseActivation(entry.Id)
		common.ApiError(c, err)
		return
	}
	// Fetch the inserted user to get the id.
	var inserted model.User
	if err := model.DB.Where("username = ?", cleanUser.Username).First(&inserted).Error; err != nil {
		common.SysError("failed to fetch inserted user after magic-link activation: " + err.Error())
	} else {
		// Seed the dynamic quota at the floor.
		floorQuota := int64(float64(common.DynamicQuotaFloorF) * common.QuotaPerUnit / 100.0)
		_ = model.SeedDynamicQuota(inserted.Id, floorQuota)
		// Re-bind the OAuth identity that got this person waitlisted, if any.
		// Failure here is non-fatal: the account is already created and usable;
		// the user can bind their social account later from the settings page.
		bindOAuthIdentityOnActivation(&inserted, entry.ProviderName, entry.ProviderUserId)
	}
	// Mark the waitlist entry as joined (consumed).
	_ = model.MarkJoined(entry.Id)
	// Best-effort welcome email. entry.Email is always present on this path.
	gopool.Go(func() {
		if err := service.SendRegistrationSuccessEmail(email); err != nil {
			common.SysError("failed to send registration success email: " + err.Error())
		}
	})
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "账号已激活，请登录 / account activated, please log in",
	})
}

// builtInProviderColumns maps the slug of each built-in OAuth provider to the
// User column that stores its bound ID. WeChat is included even though it is
// NOT registered in the oauth.Provider registry (it has its own legacy flow),
// so we bind it directly via the column. Custom/generic providers go through
// the user_oauth_bindings table instead (handled below).
var builtInProviderColumns = map[string]string{
	"github":   "github_id",
	"discord":  "discord_id",
	"oidc":     "oidc_id",
	"wechat":   "wechat_id",
	"linuxdo":  "linux_do_id",
	"telegram": "telegram_id",
}

// bindOAuthIdentityOnActivation re-binds the OAuth identity recorded on the
// waitlist entry to the freshly created user. Called only after the User row
// exists, so any failure is logged but does NOT block activation — the account
// is already usable and the user can bind their social account from settings.
//
// For built-in providers we set the provider column directly (guarding against
// the identity having been claimed by another user while the person waited).
// For custom/generic providers we look the provider up via oauth.GetProvider
// and create a user_oauth_bindings row.
func bindOAuthIdentityOnActivation(user *model.User, providerName, providerUserId string) {
	if providerName == "" || providerUserId == "" || user == nil || user.Id == 0 {
		return
	}
	// Built-in provider: set the column directly.
	if column, ok := builtInProviderColumns[providerName]; ok {
		// Guard: someone else may have claimed this OAuth identity while the
		// person was waiting. Skip the bind rather than overwriting or failing.
		taken, takenErr := isBuiltInProviderIdTaken(providerName, providerUserId)
		if takenErr != nil {
			common.SysError("bindOAuthIdentityOnActivation: failed to check " + providerName + " id: " + takenErr.Error())
			return
		}
		if taken {
			common.SysError("bindOAuthIdentityOnActivation: " + providerName + " id already taken, skipping auto-bind for user " + strconv.Itoa(user.Id))
			return
		}
		if err := model.DB.Model(&model.User{}).Where("id = ?", user.Id).
			Update(column, providerUserId).Error; err != nil {
			common.SysError("bindOAuthIdentityOnActivation: failed to set " + column + " for user " + strconv.Itoa(user.Id) + ": " + err.Error())
		}
		return
	}
	// Custom/generic provider: resolve via registry and create a binding row.
	provider := oauth.GetProvider(providerName)
	if provider == nil {
		common.SysError("bindOAuthIdentityOnActivation: provider " + providerName + " no longer registered, skipping")
		return
	}
	if provider.IsUserIDTaken(providerUserId) {
		common.SysError("bindOAuthIdentityOnActivation: " + providerName + " id already taken, skipping auto-bind for user " + strconv.Itoa(user.Id))
		return
	}
	genericProvider, ok := provider.(*oauth.GenericOAuthProvider)
	if !ok {
		common.SysError("bindOAuthIdentityOnActivation: provider " + providerName + " is not a generic provider, skipping")
		return
	}
	binding := &model.UserOAuthBinding{
		UserId:         user.Id,
		ProviderId:     genericProvider.GetProviderId(),
		ProviderUserId: providerUserId,
	}
	if err := model.CreateUserOAuthBinding(binding); err != nil {
		common.SysError("bindOAuthIdentityOnActivation: failed to create binding for user " + strconv.Itoa(user.Id) + ": " + err.Error())
	}
}

// isBuiltInProviderIdTaken reports whether a built-in provider ID is already
// bound to some user. Mirrors the per-provider Is*IdAlreadyTaken helpers but
// keyed by slug so the caller can stay generic.
func isBuiltInProviderIdTaken(providerName, providerUserId string) (bool, error) {
	switch providerName {
	case "github":
		return model.IsGitHubIdAlreadyTaken(providerUserId), nil
	case "discord":
		return model.IsDiscordIdAlreadyTaken(providerUserId), nil
	case "oidc":
		return model.IsOidcIdAlreadyTaken(providerUserId), nil
	case "wechat":
		return model.IsWeChatIdAlreadyTaken(providerUserId), nil
	case "linuxdo":
		return model.IsLinuxDOIdAlreadyTaken(providerUserId), nil
	case "telegram":
		return model.IsTelegramIdAlreadyTaken(providerUserId), nil
	default:
		return false, nil
	}
}

// ---- Admin endpoints ----

// GetWaitlistAdmin returns the full waitlist for the admin panel.
func GetWaitlistAdmin(c *gin.Context) {
	entries, err := model.AllWaitlist()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	count, _ := model.WaitlistCountWaiting()
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    entries,
		"waiting": count,
	})
}

// PromoteWaitlistEntryAdmin manually promotes a single waitlist entry (issues a
// magic link). Useful for ops overrides. Respects the TotalUserCap.
func PromoteWaitlistEntryAdmin(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "无效的 ID / invalid id"})
		return
	}
	activeCount, err := model.CountActiveNonAdminUsers()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if int(activeCount) >= common.TotalUserCap {
		c.JSON(http.StatusConflict, gin.H{"success": false, "message": "用户池已满 / user pool is full"})
		return
	}
	entry, err := model.GetWaitlistEntryByID(id)
	if err != nil || entry == nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "候补记录不存在 / entry not found"})
		return
	}
	token := common.GetUUID() + common.GetUUID()
	expiresAt := service.MagicLinkExpiry()
	if err := model.MarkPromoted(entry.Id, token, expiresAt); err != nil {
		common.ApiError(c, err)
		return
	}
	gopool.Go(func() { _ = service.SendPromotionEmail(entry.Email, token, expiresAt) })
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "已提升 / promoted"})
}

// RemoveWaitlistEntryAdmin deletes a waitlist entry.
func RemoveWaitlistEntryAdmin(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "无效的 ID / invalid id"})
		return
	}
	if err := model.RemoveWaitlistEntry(id); err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "已移除 / removed"})
}

// RunDynamicQuotaTickAdmin triggers an immediate reallocation cycle.
func RunDynamicQuotaTickAdmin(c *gin.Context) {
	go service.RunDynamicQuotaTick()
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "已调度重新分配任务 / tick scheduled"})
}

// GetDynamicQuotaTickStatusAdmin returns the last tick result.
func GetDynamicQuotaTickStatusAdmin(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"success": true, "data": service.GetDynamicQuotaTickStatus()})
}

// GetChannelBudgetsAdmin returns current-window spend per channel.
func GetChannelBudgetsAdmin(c *gin.Context) {
	rows, err := model.AllChannelBudgets()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success":   true,
		"data":      rows,
		"cap":       common.ChannelBudgetCap,
		"period":    common.ChannelBudgetCapPeriod,
	})
}

// GetDynamicQuotaOverviewAdmin returns a pool-wide summary for the system-status
// page: knob config, aggregate user stats, expected per-user quota, and channel
// pool spend. Used by the admin "系统状态" sidebar entry.
func GetDynamicQuotaOverviewAdmin(c *gin.Context) {
	capCQuota := int64(float64(common.DynamicQuotaCapC) * common.QuotaPerUnit / 100.0)
	poolStats, err := model.GetDynamicQuotaPoolStats(capCQuota)
	if err != nil {
		common.SysError("failed to get dynamic quota pool stats: " + err.Error())
	}

	channels, err := model.AllChannelBudgets()
	if err != nil {
		common.SysError("failed to get channel budgets: " + err.Error())
	}

	activeUsers, _ := model.CountActiveNonAdminUsers()
	waiting, _ := model.WaitlistCountWaiting()

	// Expected per-user quota = pool B / active users (the even-split baseline,
	// before demand weighting kicks in).
	bQuota := int64(float64(common.DynamicQuotaPoolB) * common.QuotaPerUnit / 100.0)
	expectedPerUser := int64(0)
	if activeUsers > 0 {
		expectedPerUser = bQuota / activeUsers
	}

	tick := service.GetDynamicQuotaTickStatus()

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"enabled": common.DynamicQuotaEnabled,
			"config": gin.H{
				"pool_b_cents":     common.DynamicQuotaPoolB,
				"floor_f_cents":    common.DynamicQuotaFloorF,
				"cap_c_cents":      common.DynamicQuotaCapC,
				"lookback_hours":   common.DynamicQuotaLookbackHours,
				"inactivity_days":  common.InactivityThresholdDays,
				"total_user_cap":   common.TotalUserCap,
				"channel_cap_cents":   common.ChannelBudgetCap,
				"channel_cap_period":  common.ChannelBudgetCapPeriod,
			},
			"pool": gin.H{
				"active_users":       activeUsers,
				"waitlist_size":      waiting,
				"slots_remaining":    int64(common.TotalUserCap) - activeUsers,
				"total_allocated":    poolStats.TotalAllocated, // quota units
				"total_used":         poolStats.TotalUsed,
				"average_quota":      poolStats.AverageQuota,
				"at_cap_users":       poolStats.AtCapUsers,
				"expected_per_user":  expectedPerUser, // even-split baseline, quota units
			},
			"channels":   channels,
			"tick":       tick,
		},
	})
}

// GetMyDynamicQuota returns the calling user's own dynamic-quota state for the
// console dashboard card. Read-only. If the user has no dynamic-quota row yet
// (e.g. created before dynamic quota was enabled), it is seeded here at the
// floor so the card shows a real quota instead of $0.
func GetMyDynamicQuota(c *gin.Context) {
	userId := c.GetInt("id")
	dq, err := model.GetDynamicQuota(userId)
	if err != nil || dq == nil {
		// Seed on first access so every active user gets a quota to see.
		floorQuota := int64(float64(common.DynamicQuotaFloorF) * common.QuotaPerUnit / 100.0)
		if seedErr := model.SeedDynamicQuota(userId, floorQuota); seedErr == nil {
			dq, err = model.GetDynamicQuota(userId)
		}
		if err != nil || dq == nil {
			c.JSON(http.StatusOK, gin.H{
				"success":       true,
				"enabled":       common.DynamicQuotaEnabled,
				"hourly_quota":  0,
				"hour_used":     0,
				"demand_24h":    0,
				"weight":        0,
				"last_request":  nil,
				"allocated_at":  nil,
			})
			return
		}
	}
	// demand weight = this user's 24h demand as a % of the pool budget B.
	weight := 0.0
	B := float64(common.DynamicQuotaPoolB)
	if B > 0 {
		weight = float64(service.QuotaToCents(dq.Demand24h)) / B * 100.0
	}
	// "remaining" is the live wallet balance (the actual spendable amount),
	// since dynamic quota IS the wallet balance. Fall back to the computed
	// difference if the wallet read fails.
	walletQuota, wErr := model.GetUserQuota(userId, true)
	hourRemaining := dq.HourlyQuota - dq.HourUsed
	if wErr == nil {
		hourRemaining = int64(walletQuota)
	}
	c.JSON(http.StatusOK, gin.H{
		"success":             true,
		"enabled":             common.DynamicQuotaEnabled,
		"hourly_quota":        service.QuotaToCents(dq.HourlyQuota),
		"hour_used":           service.QuotaToCents(dq.HourUsed),
		"hour_remaining":      service.QuotaToCents(hourRemaining),
		"demand_24h":          service.QuotaToCents(dq.Demand24h),
		"weight":              weight,
		"last_request":        dq.LastRequestAt,
		"allocated_at":        dq.AllocatedAt,
		"inactivity_days":     common.InactivityThresholdDays,
		"days_until_eviction": evictDaysRemaining(dq.LastRequestAt),
	})
}

func evictDaysRemaining(lastRequest time.Time) int {
	if common.InactivityThresholdDays <= 0 {
		return -1
	}
	if lastRequest.IsZero() {
		return common.InactivityThresholdDays
	}
	deadline := lastRequest.AddDate(0, 0, common.InactivityThresholdDays)
	remaining := int(deadline.Sub(time.Now()).Hours() / 24)
	if remaining < 0 {
		remaining = 0
	}
	return remaining
}
