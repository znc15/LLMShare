package service

import (
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/bytedance/gopkg/util/gopool"
)

// tickState records the result of the most recent hourly tick, surfaced to the
// admin "tick status" panel.
type tickState struct {
	mu            sync.RWMutex
	lastRunAt     time.Time
	nextRunAt     time.Time
	evictions     int
	promotions    int
	lastError     string
	running       bool
}

var dynamicQuotaTick = &tickState{}

// GetDynamicQuotaTickStatus returns a snapshot of the last tick for the admin UI.
type DynamicQuotaTickStatus struct {
	LastRunAt  time.Time `json:"last_run_at"`
	NextRunAt  time.Time `json:"next_run_at"`
	Evictions  int       `json:"evictions"`
	Promotions int       `json:"promotions"`
	LastError  string    `json:"last_error"`
	Running    bool      `json:"running"`
}

func GetDynamicQuotaTickStatus() DynamicQuotaTickStatus {
	dynamicQuotaTick.mu.RLock()
	defer dynamicQuotaTick.mu.RUnlock()
	return DynamicQuotaTickStatus{
		LastRunAt:  dynamicQuotaTick.lastRunAt,
		NextRunAt:  dynamicQuotaTick.nextRunAt,
		Evictions:  dynamicQuotaTick.evictions,
		Promotions: dynamicQuotaTick.promotions,
		LastError:  dynamicQuotaTick.lastError,
		Running:    dynamicQuotaTick.running,
	}
}

func setTickState(evictions, promotions int, runErr error) {
	dynamicQuotaTick.mu.Lock()
	defer dynamicQuotaTick.mu.Unlock()
	dynamicQuotaTick.lastRunAt = time.Now()
	dynamicQuotaTick.nextRunAt = nextHourBoundary(time.Now())
	dynamicQuotaTick.evictions = evictions
	dynamicQuotaTick.promotions = promotions
	if runErr != nil {
		dynamicQuotaTick.lastError = runErr.Error()
	} else {
		dynamicQuotaTick.lastError = ""
	}
}

// runGuard prevents overlapping ticks (manual "run now" + scheduled tick).
var runGuard int32

// StartDynamicQuotaScheduler launches the background goroutine that fires the
// hourly tick aligned to the :00 boundary. It also seeds dynamic-quota rows
// for pre-existing users on first run so they are not locked out.
func StartDynamicQuotaScheduler() {
	// Seed existing users at startup (best-effort).
	floor := centsToQuota(int64(common.DynamicQuotaFloorF))
	if seeded, err := model.EnsureDynamicQuotaForActiveUsers(floor); err != nil {
		common.SysError("failed to seed dynamic quota for existing users: " + err.Error())
	} else if seeded > 0 {
		common.SysLog("dynamic quota: seeded " + intToStr(seeded) + " existing users")
	}
	dynamicQuotaTick.mu.Lock()
	dynamicQuotaTick.nextRunAt = nextHourBoundary(time.Now())
	dynamicQuotaTick.mu.Unlock()

	gopool.Go(func() {
		for {
			now := time.Now()
			next := nextHourBoundary(now)
			dynamicQuotaTick.mu.Lock()
			dynamicQuotaTick.nextRunAt = next
			dynamicQuotaTick.mu.Unlock()
			sleepUntil := time.Until(next)
			if sleepUntil < 0 {
				sleepUntil = 0
			}
			time.Sleep(sleepUntil)
			RunDynamicQuotaTick()
		}
	})
}

func intToStr(i int) string {
	if i == 0 {
		return "0"
	}
	buf := []byte{}
	if i < 0 {
		buf = append(buf, '-')
		i = -i
	}
	digits := []byte{}
	for i > 0 {
		digits = append([]byte{byte('0' + i%10)}, digits...)
		i /= 10
	}
	return string(append(buf, digits...))
}

// RunDynamicQuotaTick executes the full hourly cycle: evict → promote →
// reallocate. It is safe to call manually (admin "run now" button); an atomic
// guard prevents overlapping runs.
func RunDynamicQuotaTick() {
	if !atomic.CompareAndSwapInt32(&runGuard, 0, 1) {
		common.SysLog("dynamic quota tick already running, skipping")
		return
	}
	defer atomic.StoreInt32(&runGuard, 0)

	dynamicQuotaTick.mu.Lock()
	dynamicQuotaTick.running = true
	dynamicQuotaTick.mu.Unlock()
	defer func() {
		dynamicQuotaTick.mu.Lock()
		dynamicQuotaTick.running = false
		dynamicQuotaTick.mu.Unlock()
	}()

	common.SysLog("dynamic quota tick starting")

	evicted, err := evictInactiveUsers()
	if err != nil {
		common.SysError("dynamic quota evict step failed: " + err.Error())
		setTickState(evicted, 0, err)
		return
	}

	promoted, err := promoteFromWaitlist()
	if err != nil {
		common.SysError("dynamic quota promote step failed: " + err.Error())
		setTickState(evicted, promoted, err)
		return
	}

	// Also sweep expired magic links (promoted users who never activated) back
	// to the queue, freeing their slot for the next promotion cycle.
	expired, err := model.ExpiredPromotions()
	if err == nil {
		for _, e := range expired {
			_ = model.MarkExpired(e.Id)
		}
	}

	if err := reallocateQuotas(); err != nil {
		common.SysError("dynamic quota reallocate step failed: " + err.Error())
		setTickState(evicted, promoted, err)
		return
	}

	// Prune old spend buckets beyond the lookback window.
	lookback := time.Duration(common.DynamicQuotaLookbackHours) * time.Hour
	if err := model.PruneUserSpendBuckets(time.Now().Add(-lookback)); err != nil {
		common.SysError("dynamic quota prune step failed: " + err.Error())
	}

	// Clear the in-memory exhausted-channel cache so channels get a fresh
	// chance at the new window boundary.
	ClearAllExhaustedChannels()

	setTickState(evicted, promoted, nil)
	common.SysLog("dynamic quota tick done: evicted=" + intToStr(evicted) + " promoted=" + intToStr(promoted))
}

// evictInactiveUsers hard-deletes users whose last successful request is older
// than the inactivity threshold. Admin/root users are protected. Returns the
// number of users evicted.
func evictInactiveUsers() (int, error) {
	if common.InactivityThresholdDays <= 0 {
		return 0, nil
	}
	threshold := time.Now().AddDate(0, 0, -common.InactivityThresholdDays)
	candidateIds, err := model.EvictableDynamicQuotaUserIds(threshold)
	if err != nil {
		return 0, err
	}
	evicted := 0
	for _, id := range candidateIds {
		user, err := model.GetUserById(id, false)
		if err != nil || user == nil {
			// already gone; just clean up the dynamic_quota row
			_ = model.DeleteDynamicQuota(id)
			continue
		}
		// Never evict admin (>=10) or root users.
		if user.Role >= common.RoleAdminUser {
			// refresh their last_request_at so they stop appearing as evictable
			model.TouchDynamicQuotaLastRequest(id)
			continue
		}
		email := user.Email
		if err := model.HardDeleteUserById(id); err != nil {
			common.SysError("failed to hard delete user " + intToStr(id) + ": " + err.Error())
			continue
		}
		_ = model.DeleteDynamicQuota(id)
		_ = model.DeleteUserSpendBuckets(id)
		evicted++
		// Best-effort eviction notice (the user is gone, email may bounce).
		if email != "" {
			gopool.Go(func() { _ = SendEvictionEmail(email) })
		}
	}
	return evicted, nil
}

// promoteFromWaitlist promotes front-of-queue waitlisters into the slots freed
// by eviction (and any other free slots up to TotalUserCap). Each promoted
// user gets a magic link valid for MagicLinkTTLHours. No User row is created
// yet — that happens on magic-link click.
func promoteFromWaitlist() (int, error) {
	// Determine how many slots are free.
	activeCount, err := model.CountActiveNonAdminUsers()
	if err != nil {
		return 0, err
	}
	freeSlots := common.TotalUserCap - int(activeCount)
	if freeSlots <= 0 {
		return 0, nil
	}
	entries, err := model.PopWaitlistFront(freeSlots)
	if err != nil {
		return 0, err
	}
	promoted := 0
	ttl := time.Duration(common.MagicLinkTTLHours) * time.Hour
	for _, e := range entries {
		token := common.GetUUID() + common.GetUUID()
		expiresAt := time.Now().Add(ttl)
		if err := model.MarkPromoted(e.Id, token, expiresAt); err != nil {
			common.SysError("failed to mark waitlist entry promoted: " + err.Error())
			continue
		}
		promoted++
		entry := e
		gopool.Go(func() { _ = SendPromotionEmail(entry.Email, token, expiresAt) })
	}
	return promoted, nil
}

// reallocateQuotas recomputes every active user's hourly quota from the
// proportional-demand formula and writes it back. Floor + proportional
// remainder, clipped at cap, leftover = slack.
func reallocateQuotas() error {
	B := centsToQuota(int64(common.DynamicQuotaPoolB))
	F := centsToQuota(int64(common.DynamicQuotaFloorF))
	C := centsToQuota(int64(common.DynamicQuotaCapC))
	if B <= 0 {
		return nil
	}
	if C < F {
		C = F // cap cannot be below floor
	}

	lookback := time.Duration(common.DynamicQuotaLookbackHours) * time.Hour
	since := time.Now().Add(-lookback)
	rows, err := model.AggregateUserSpendSince(since)
	if err != nil {
		return err
	}

	// Map demand by user id and compute the total demand S.
	demand := make(map[int]int64, len(rows))
	var S int64
	for _, r := range rows {
		demand[r.UserId] = r.Total
		S += r.Total
	}

	// All active users (those with a dynamic_quota row) participate.
	all, err := model.AllDynamicQuotas()
	if err != nil {
		return err
	}
	n := int64(len(all))
	// remainder pool after guaranteeing everyone the floor.
	remainder := B - n*F
	if remainder < 0 {
		// Budget too small to even give everyone the floor: everyone gets B/n.
		// This is a misconfiguration; clamp so we still write something.
		remainder = 0
		F = 0
		if n > 0 {
			F = B / n
		}
	}

	for _, dq := range all {
		si := demand[dq.UserId]
		var share int64 = F
		if S > 0 {
			share = F + int64(float64(remainder)*float64(si)/float64(S))
		}
		if share < F {
			share = F
		}
		if share > C {
			share = C
		}
		if err := model.SetDynamicQuotaHourly(dq.UserId, share, si); err != nil {
			common.SysError("failed to set dynamic quota for user " + intToStr(dq.UserId) + ": " + err.Error())
			continue
		}
		// Dynamic quota IS the wallet balance: reset the user's wallet to the
		// freshly-allocated hourly quota so API calls can actually spend it.
		if err := model.SetUserWalletQuota(dq.UserId, share); err != nil {
			common.SysError("failed to set wallet quota for user " + intToStr(dq.UserId) + ": " + err.Error())
		}
	}
	return nil
}

// nextHourBoundary returns the next top-of-the-hour after t.
func nextHourBoundary(t time.Time) time.Time {
	return t.Truncate(time.Hour).Add(time.Hour)
}
