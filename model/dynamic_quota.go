package model

import (
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// DynamicQuota tracks each user's current hourly quota, in-hour usage, cached
// 24h demand and the timestamp of their last successful request (which drives
// eviction). One row per active user; seeded with HourlyQuota = floor on
// promotion and recomputed by the hourly reallocation tick.
type DynamicQuota struct {
	UserId        int       `json:"user_id" gorm:"primaryKey;column:user_id"`
	HourlyQuota   int64     `json:"hourly_quota" gorm:"type:bigint;default:0;column:hourly_quota"`
	HourUsed      int64     `json:"hour_used" gorm:"type:bigint;default:0;column:hour_used"`
	Demand24h     int64     `json:"demand_24h" gorm:"type:bigint;default:0;column:demand_24h"`
	LastRequestAt time.Time `json:"last_request_at" gorm:"column:last_request_at"`
	AllocatedAt   time.Time `json:"allocated_at" gorm:"column:allocated_at"`
}

func (DynamicQuota) TableName() string {
	return "dynamic_quotas"
}

// GetDynamicQuota returns the row for the given user, or nil if absent.
func GetDynamicQuota(userId int) (*DynamicQuota, error) {
	var dq DynamicQuota
	err := DB.Where("user_id = ?", userId).First(&dq).Error
	if err != nil {
		return nil, err
	}
	return &dq, nil
}

// SeedDynamicQuota creates the row for a freshly-promoted user with the floor
// as their initial hourly quota, and also sets their wallet balance to the
// floor so they can start using the API before the next tick.
func SeedDynamicQuota(userId int, floor int64) error {
	dq := DynamicQuota{
		UserId:        userId,
		HourlyQuota:   floor,
		HourUsed:      0,
		Demand24h:     0,
		LastRequestAt: time.Now(),
		AllocatedAt:   time.Now(),
	}
	if err := DB.Create(&dq).Error; err != nil {
		return err
	}
	// Set wallet so the user can spend immediately (dynamic quota = wallet).
	_ = SetUserWalletQuota(userId, floor)
	return nil
}

// IncrementDynamicQuotaUsage atomically increments the user's in-hour spend by
// `amount` and refreshes the last-request timestamp. Called from the
// post-consume path. For zero/negative amounts (free models) it only touches
// the last-request timestamp so the user is not evicted for inactivity.
func IncrementDynamicQuotaUsage(userId int, amount int64) error {
	now := time.Now()
	if amount <= 0 {
		return DB.Model(&DynamicQuota{}).Where("user_id = ?", userId).
			Update("last_request_at", now).Error
	}
	return DB.Model(&DynamicQuota{}).Where("user_id = ?", userId).
		Updates(map[string]interface{}{
			"hour_used":       gorm.Expr("hour_used + ?", amount),
			"last_request_at": now,
		}).Error
}

// TouchDynamicQuotaLastRequest refreshes the last-request timestamp only.
func TouchDynamicQuotaLastRequest(userId int) {
	if err := DB.Model(&DynamicQuota{}).Where("user_id = ?", userId).
		Update("last_request_at", time.Now()).Error; err != nil {
		common.SysError("failed to touch dynamic_quota last_request_at: " + err.Error())
	}
}

// AllDynamicQuotas returns every NON-ADMIN active user's dynamic quota row,
// used by the hourly reallocation tick. Admin/root users (role >= 10) are
// excluded so their wallet balances are never overwritten by dynamic quota.
func AllDynamicQuotas() ([]DynamicQuota, error) {
	var rows []DynamicQuota
	err := DB.Joins("JOIN users ON users.id = dynamic_quotas.user_id").
		Where("users.role < ?", 10).
		Find(&rows).Error
	return rows, err
}

// DynamicQuotaPoolStats aggregates pool-wide stats for the system-status page:
// number of active users, total hourly quota allocated, total hourly used,
// average quota, and the count of users at/over their cap.
type DynamicQuotaPoolStats struct {
	ActiveUsers    int64 `json:"active_users"`
	TotalAllocated int64 `json:"total_allocated"` // sum of hourly_quota across users (quota units)
	TotalUsed      int64 `json:"total_used"`      // sum of hour_used
	AverageQuota   int64 `json:"average_quota"`
	AtCapUsers     int64 `json:"at_cap_users"` // users whose hourly_quota >= current cap
	MinQuota       int64 `json:"min_quota"`
	MaxQuota       int64 `json:"max_quota"`
}

// GetDynamicQuotaPoolStats aggregates the pool stats in a single query. capC
// is passed in to compute at_cap_users (avoids a config import cycle in model).
func GetDynamicQuotaPoolStats(capC int64) (DynamicQuotaPoolStats, error) {
	var s DynamicQuotaPoolStats
	err := DB.Model(&DynamicQuota{}).Select(
		"COUNT(*) AS active_users, " +
			"COALESCE(SUM(hourly_quota),0) AS total_allocated, " +
			"COALESCE(SUM(hour_used),0) AS total_used, " +
			"COALESCE(MIN(hourly_quota),0) AS min_quota, " +
			"COALESCE(MAX(hourly_quota),0) AS max_quota, " +
			"SUM(CASE WHEN hourly_quota >= ? THEN 1 ELSE 0 END) AS at_cap_users",
	).Where(capC).Scan(&s).Error
	return s, err
}

// SetDynamicQuotaHourly applies the freshly-computed allocation for one user in
// a single update: new hourly quota, reset in-hour usage to 0, cache the 24h
// demand, and stamp the allocation time.
func SetDynamicQuotaHourly(userId int, hourlyQuota, demand24h int64) error {
	return DB.Model(&DynamicQuota{}).Where("user_id = ?", userId).
		Updates(map[string]interface{}{
			"hourly_quota": hourlyQuota,
			"hour_used":    0,
			"demand_24h":   demand24h,
			"allocated_at": time.Now(),
		}).Error
}

// SetUserWalletQuota overwrites the user's wallet balance to the given amount.
// Used by the dynamic-quota tick so "dynamic quota IS the wallet balance":
// each hour the wallet is reset to the freshly-allocated hourly quota, then
// API calls deduct from it normally. (Not used when dynamic quota is off.)
func SetUserWalletQuota(userId int, quota int64) error {
	return DB.Model(&User{}).Where("id = ?", userId).
		Update("quota", quota).Error
}

// DeleteDynamicQuota removes a user's row (used on eviction / hard delete).
func DeleteDynamicQuota(userId int) error {
	return DB.Where("user_id = ?", userId).Delete(&DynamicQuota{}).Error
}

// EvictableDynamicQuotaUserIds returns the user ids whose last successful
// request is older than `threshold`. These users will be hard-deleted by the
// hourly tick. Admin (role >= 10) and root users are never evicted; that guard
// is applied at the call site by cross-referencing the users table.
func EvictableDynamicQuotaUserIds(threshold time.Time) ([]int, error) {
	var ids []int
	err := DB.Model(&DynamicQuota{}).
		Where("last_request_at < ?", threshold).
		Pluck("user_id", &ids).Error
	return ids, err
}

// EnsureDynamicQuotaForActiveUsers seeds a DynamicQuota row for every enabled,
// non-admin user that does not yet have one. Called once at startup so that
// pre-existing users are not locked out before the first tick runs. They get
// the floor as their initial quota.
func EnsureDynamicQuotaForActiveUsers(floor int64) (int, error) {
	// Find enabled non-admin users without a dynamic_quota row.
	var userIds []int
	err := DB.Table("users").
		Select("users.id").
		Joins("LEFT JOIN dynamic_quotas ON dynamic_quotas.user_id = users.id").
		Where("users.status = ? AND users.role < ? AND dynamic_quotas.user_id IS NULL", 1, 10).
		Pluck("users.id", &userIds).Error
	if err != nil {
		return 0, err
	}
	now := time.Now()
	for _, id := range userIds {
		dq := DynamicQuota{
			UserId:        id,
			HourlyQuota:   floor,
			LastRequestAt: now,
			AllocatedAt:   now,
		}
		if err := DB.Create(&dq).Error; err != nil {
			// ignore duplicate-key races (another node may have just seeded it)
			continue
		}
		// Dynamic quota = wallet: give them the floor balance so they can
		// spend before the first tick reallocates.
		_ = SetUserWalletQuota(id, floor)
	}
	return len(userIds), nil
}

