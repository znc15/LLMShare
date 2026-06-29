package model

import (
	"time"

	"gorm.io/gorm"
)

const (
	WaitlistStatusWaiting    = "waiting"
	WaitlistStatusPromoted   = "promoted"
	WaitlistStatusActivating = "activating" // claimed by ConsumeMagicToken, in-flight activation
	WaitlistStatusExpired    = "expired"
	WaitlistStatusJoined     = "joined" // user clicked the magic link and became a full user
)

// WaitlistEntry is one person on the registration waitlist. The list is FIFO
// by JoinedAt among Status=="waiting". On promotion a magic token is issued;
// the actual User row is only created when the magic link is consumed.
type WaitlistEntry struct {
	Id             int        `json:"id" gorm:"primaryKey;autoIncrement"`
	Email          string     `json:"email" gorm:"type:varchar(50);not null;uniqueIndex"`
	JoinedAt       time.Time  `json:"joined_at" gorm:"not null;index"`
	Status         string     `json:"status" gorm:"type:varchar(16);not null;default:'waiting';index"`
	PromotedAt     *time.Time `json:"promoted_at" gorm:"index"`
	MagicToken     string     `json:"-" gorm:"type:varchar(64);index"`
	MagicExpiresAt *time.Time `json:"magic_expires_at"`
	CreatedAt      time.Time  `json:"created_at" gorm:"autoCreateTime"`
}

func (WaitlistEntry) TableName() string {
	return "waitlist_entries"
}

// AddToWaitlist creates a waiting entry for the email. If the email already
// exists in any non-removed status, it returns the existing row instead of
// duplicating. Performs a defensive length check (the column is varchar(50)).
func AddToWaitlist(email string) (*WaitlistEntry, bool, error) {
	// Defensive: reject empty or oversized emails even if a caller bypasses the
	// controller's binding validation, to avoid DB truncation/length errors.
	if email == "" || len(email) > 50 {
		return nil, false, gorm.ErrInvalidData
	}
	var existing WaitlistEntry
	err := DB.Where("email = ?", email).First(&existing).Error
	if err == nil {
		return &existing, false, nil
	}
	if err != gorm.ErrRecordNotFound {
		return nil, false, err
	}
	entry := WaitlistEntry{
		Email:    email,
		JoinedAt: time.Now(),
		Status:   WaitlistStatusWaiting,
	}
	if err := DB.Create(&entry).Error; err != nil {
		return nil, false, err
	}
	return &entry, true, nil
}

// WaitlistPosition returns the 1-based position of an email in the waiting
// queue, or 0 if not waiting.
func WaitlistPosition(email string) (int, error) {
	var entry WaitlistEntry
	err := DB.Where("email = ? AND status = ?", email, WaitlistStatusWaiting).First(&entry).Error
	if err != nil {
		return 0, nil
	}
	var count int64
	err = DB.Model(&WaitlistEntry{}).
		Where("status = ? AND joined_at < ?", WaitlistStatusWaiting, entry.JoinedAt).
		Count(&count).Error
	return int(count) + 1, err
}

// WaitlistCountWaiting returns how many entries are ahead of new joiners.
func WaitlistCountWaiting() (int64, error) {
	var count int64
	err := DB.Model(&WaitlistEntry{}).Where("status = ?", WaitlistStatusWaiting).Count(&count).Error
	return count, err
}

// GetWaitlistEntryByEmail returns the entry for an email, if any.
func GetWaitlistEntryByEmail(email string) (*WaitlistEntry, error) {
	var entry WaitlistEntry
	err := DB.Where("email = ?", email).First(&entry).Error
	if err != nil {
		return nil, err
	}
	return &entry, nil
}

// GetWaitlistEntryByID returns the entry for an id, if any.
func GetWaitlistEntryByID(id int) (*WaitlistEntry, error) {
	var entry WaitlistEntry
	err := DB.Where("id = ?", id).First(&entry).Error
	if err != nil {
		return nil, err
	}
	return &entry, nil
}

// PopWaitlistFront returns up to `n` front-of-queue waiting entries ordered by
// JoinedAt ASC. Used by the promotion step of the hourly tick.
func PopWaitlistFront(n int) ([]WaitlistEntry, error) {
	var entries []WaitlistEntry
	err := DB.Where("status = ?", WaitlistStatusWaiting).
		Order("joined_at ASC").
		Limit(n).
		Find(&entries).Error
	return entries, err
}

// MarkPromoted issues a magic token for an entry and marks it promoted.
func MarkPromoted(entryId int, token string, expiresAt time.Time) error {
	return DB.Model(&WaitlistEntry{}).Where("id = ?", entryId).
		Updates(map[string]interface{}{
			"status":           WaitlistStatusPromoted,
			"magic_token":      token,
			"magic_expires_at": expiresAt,
			"promoted_at":      time.Now(),
		}).Error
}

// ConsumeMagicToken validates a magic token AND atomically claims it to prevent
// concurrent double-activation. It does an atomic UPDATE
// `promoted -> activating` (only one concurrent request can succeed — the
// others get 0 rows affected), then returns the entry. The caller must later
// call MarkJoined on success or ReleaseActivation on failure to release the
// claim. Token must exist, be in "promoted" status, and not be expired.
func ConsumeMagicToken(token string) (*WaitlistEntry, error) {
	if token == "" {
		return nil, gorm.ErrRecordNotFound
	}
	// Atomic claim: promoted -> activating. RowsAffected==0 means already
	// claimed, already joined, or token not found — all collapse to "not found"
	// so we don't leak state to the caller.
	res := DB.Model(&WaitlistEntry{}).
		Where("magic_token = ? AND status = ?", token, WaitlistStatusPromoted).
		Update("status", WaitlistStatusActivating)
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected == 0 {
		return nil, gorm.ErrRecordNotFound
	}
	var entry WaitlistEntry
	err := DB.Where("magic_token = ? AND status = ?", token, WaitlistStatusActivating).First(&entry).Error
	if err != nil {
		return nil, err
	}
	// Expiry check after claim — if expired, release back to waiting.
	if entry.MagicExpiresAt != nil && entry.MagicExpiresAt.Before(time.Now()) {
		_ = DB.Model(&WaitlistEntry{}).Where("id = ?", entry.Id).
			Updates(map[string]interface{}{
				"status":           WaitlistStatusWaiting,
				"joined_at":        time.Now(),
				"magic_token":      "",
				"magic_expires_at": nil,
				"promoted_at":      nil,
			}).Error
		return nil, gorm.ErrRecordNotFound
	}
	return &entry, nil
}

// MarkJoined flips an activating entry to "joined" once the user account exists.
func MarkJoined(entryId int) error {
	return DB.Model(&WaitlistEntry{}).Where("id = ?", entryId).
		Update("status", WaitlistStatusJoined).Error
}

// ReleaseActivation returns an activating entry back to "promoted" so the
// magic link can be retried. Called when user creation fails after claiming.
func ReleaseActivation(entryId int) error {
	return DB.Model(&WaitlistEntry{}).Where("id = ?", entryId).
		Update("status", WaitlistStatusPromoted).Error
}

// MarkExpired sets a promoted entry whose magic link expired back to waiting
// (re-joins at the back of the queue) — used by the hourly tick sweep.
func MarkExpired(entryId int) error {
	return DB.Model(&WaitlistEntry{}).Where("id = ?", entryId).
		Updates(map[string]interface{}{
			"status":           WaitlistStatusWaiting,
			"joined_at":        time.Now(), // back of queue
			"magic_token":      "",
			"magic_expires_at": nil,
			"promoted_at":      nil,
		}).Error
}

// ExpiredPromotions returns promoted entries whose magic link has expired.
func ExpiredPromotions() ([]WaitlistEntry, error) {
	var entries []WaitlistEntry
	err := DB.Where("status = ? AND magic_expires_at < ?", WaitlistStatusPromoted, time.Now()).
		Find(&entries).Error
	return entries, err
}

// AllWaitlist returns entries for the admin view, newest first.
func AllWaitlist() ([]WaitlistEntry, error) {
	var entries []WaitlistEntry
	err := DB.Order("joined_at DESC").Find(&entries).Error
	return entries, err
}

// RemoveWaitlistEntry deletes an entry (admin manual removal).
func RemoveWaitlistEntry(entryId int) error {
	return DB.Where("id = ?", entryId).Delete(&WaitlistEntry{}).Error
}
