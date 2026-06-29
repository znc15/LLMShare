package model

import (
	"time"

	"gorm.io/gorm"
)

// UserSpendBucket records one user's quota spend in a single hour. The hourly
// reallocation tick aggregates these over the lookback window (default 24h) to
// derive each user's demand weight, then prunes old rows.
type UserSpendBucket struct {
	Id        int       `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId    int       `json:"user_id" gorm:"not null;uniqueIndex:idx_user_hour_bucket,priority:1;index:idx_hour_bucket"`
	HourBucket time.Time `json:"hour_bucket" gorm:"not null;uniqueIndex:idx_user_hour_bucket,priority:2;index:idx_hour_bucket"` // truncated to the hour
	Spend     int64     `json:"spend" gorm:"type:bigint;default:0"`
}

func (UserSpendBucket) TableName() string {
	return "user_spend_buckets"
}

// AddUserSpendBucket upserts the current-hour bucket for a user, adding
// `amount` to the running hourly spend. Called from the post-consume path.
func AddUserSpendBucket(userId int, amount int64) error {
	if amount <= 0 {
		return nil
	}
	hour := currentHour()
	bucket := UserSpendBucket{UserId: userId, HourBucket: hour}
	// FirstOrCreate to ensure the row exists, then increment atomically.
	if err := DB.Where("user_id = ? AND hour_bucket = ?", userId, hour).
		FirstOrCreate(&bucket, UserSpendBucket{UserId: userId, HourBucket: hour, Spend: 0}).Error; err != nil {
		return err
	}
	return DB.Model(&UserSpendBucket{}).
		Where("user_id = ? AND hour_bucket = ?", userId, hour).
		Update("spend", gorm.Expr("spend + ?", amount)).Error
}

// UserSpendRow is the aggregated demand result for one user.
type UserSpendRow struct {
	UserId int    `gorm:"column:user_id"`
	Total  int64  `gorm:"column:total"`
	Email  string `gorm:"column:email"`
}

// AggregateUserSpendSince returns each user's total spend since `since`,
// joined to users for the email (used for eviction notices). Only users that
// still exist are returned.
func AggregateUserSpendSince(since time.Time) ([]UserSpendRow, error) {
	var rows []UserSpendRow
	err := DB.Table("user_spend_buckets").
		Select("user_spend_buckets.user_id as user_id, SUM(user_spend_buckets.spend) as total, users.email as email").
		Joins("LEFT JOIN users ON users.id = user_spend_buckets.user_id").
		Where("user_spend_buckets.hour_bucket >= ?", since).
		Group("user_spend_buckets.user_id").
		Scan(&rows).Error
	return rows, err
}

// PruneUserSpendBuckets deletes buckets older than `before`.
func PruneUserSpendBuckets(before time.Time) error {
	return DB.Where("hour_bucket < ?", before).Delete(&UserSpendBucket{}).Error
}

// DeleteUserSpendBuckets removes all spend buckets for a user (on eviction).
func DeleteUserSpendBuckets(userId int) error {
	return DB.Where("user_id = ?", userId).Delete(&UserSpendBucket{}).Error
}

// currentHour returns the current time truncated to the top of the hour, in UTC.
// UTC is used for the same reason as CurrentWindowStart: the mysql driver
// serializes time.Time as UTC (no `loc=` in the DSN), so reads and writes of
// the hour bucket must agree on timezone.
func currentHour() time.Time {
	now := time.Now().UTC()
	return time.Date(now.Year(), now.Month(), now.Day(), now.Hour(), 0, 0, 0, time.UTC)
}
