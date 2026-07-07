package model

import (
	"errors"
	"fmt"
	"strconv"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// Invitation code status constants. Mirroring redemption's convention: 1 =
// enabled/unused, anything else means consumed or otherwise not redeemable.
const (
	InvitationCodeStatusUnused = 1
	InvitationCodeStatusUsed   = 2
)

// InvitationCode is a one-time registration gate. An admin generates a batch
// (optionally with an expiry); a new user must supply a valid code at signup,
// which is consumed atomically with user creation. Replaces the removed
// user-pool cap as the registration control mechanism.
type InvitationCode struct {
	Id            int            `json:"id"`
	Code          string         `json:"code" gorm:"type:varchar(32);uniqueIndex"`
	Name          string         `json:"name" gorm:"index"` // admin-set label (e.g. "for alice")
	Status        int            `json:"status" gorm:"default:1"`
	CreatedUserId int            `json:"created_user_id"` // admin who generated it
	UsedUserId    int            `json:"used_user_id"`    // user who consumed it
	CreatedTime   int64          `json:"created_time" gorm:"bigint"`
	UsedTime      int64          `json:"used_time" gorm:"bigint"`
	ExpiredTime   int64          `json:"expired_time" gorm:"bigint"` // 0 = never expires
	DeletedAt     gorm.DeletedAt `gorm:"index"`
}

// IsValid reports whether the code is still redeemable right now: unused and
// not past its expiry. Used for pre-checks before the consume transaction.
func (c *InvitationCode) IsValid() bool {
	if c == nil {
		return false
	}
	if c.Status != InvitationCodeStatusUnused {
		return false
	}
	if c.ExpiredTime != 0 && c.ExpiredTime < common.GetTimestamp() {
		return false
	}
	return true
}

// FindInvitationCode returns the code row matching the given code string,
// regardless of status. Callers check IsValid() before consuming.
func FindInvitationCode(code string) (*InvitationCode, error) {
	if code == "" {
		return nil, errors.New("邀请码为空")
	}
	inv := &InvitationCode{}
	err := DB.Where("code = ?", code).First(inv).Error
	if err != nil {
		return nil, err
	}
	return inv, nil
}

// ConsumeInvitationCodeWithTx atomically marks the code as used by userId.
// The WHERE clause (status=unused AND not expired) makes consumption
// race-safe: two concurrent registrations with the same code will see
// RowsAffected==1 for the first and ==0 for the second. Must be called inside
// the user-creation transaction so a later failure rolls back consumption.
func ConsumeInvitationCodeWithTx(tx *gorm.DB, code string, userId int) error {
	if code == "" {
		return errors.New("邀请码为空")
	}
	if userId == 0 {
		return errors.New("无效的用户 ID")
	}
	now := common.GetTimestamp()
	result := tx.Model(&InvitationCode{}).
		Where("code = ? AND status = ? AND (expired_time = 0 OR expired_time > ?)",
			code, InvitationCodeStatusUnused, now).
		Updates(map[string]interface{}{
			"status":        InvitationCodeStatusUsed,
			"used_user_id":  userId,
			"used_time":     now,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return errors.New("邀请码无效、已被使用或已过期")
	}
	return nil
}

// GenerateInvitationCodes creates count one-time codes in one shot. expireDays
// <= 0 means never expire. createdBy is the admin's user id. Returns the
// generated rows (including their codes) so the caller can display them once.
func GenerateInvitationCodes(count int, name string, createdBy int, expireDays int) ([]*InvitationCode, error) {
	if count <= 0 {
		return nil, errors.New("生成数量必须大于 0")
	}
	if count > 1000 {
		return nil, errors.New("单次生成数量不能超过 1000")
	}
	now := common.GetTimestamp()
	var expiredTime int64
	if expireDays > 0 {
		expiredTime = now + int64(expireDays)*86400
	}
	codes := make([]*InvitationCode, 0, count)
	// Generate each code with a uniqueness retry loop. 12 chars from the
	// alphanumeric space (~3.2e21) makes collisions astronomically unlikely,
	// but the uniqueIndex + retry still guards the edge case.
	for i := 0; i < count; i++ {
		var code string
		for attempt := 0; attempt < 5; attempt++ {
			candidate := common.GetRandomString(12)
			// Confirm not already present (in DB or in this batch).
			var existing int64
			if err := DB.Model(&InvitationCode{}).Where("code = ?", candidate).Count(&existing).Error; err != nil {
				return nil, err
			}
			if existing > 0 {
				continue
			}
			dupInBatch := false
			for _, c := range codes {
				if c.Code == candidate {
					dupInBatch = true
					break
				}
			}
			if dupInBatch {
				continue
			}
			code = candidate
			break
		}
		if code == "" {
			return nil, fmt.Errorf("无法生成唯一的邀请码（尝试 5 次后仍冲突）")
		}
		codes = append(codes, &InvitationCode{
			Code:          code,
			Name:          name,
			Status:        InvitationCodeStatusUnused,
			CreatedUserId: createdBy,
			CreatedTime:   now,
			ExpiredTime:   expiredTime,
		})
	}
	if err := DB.Create(&codes).Error; err != nil {
		return nil, err
	}
	return codes, nil
}

// GetAllInvitationCodes returns a paginated list ordered by newest first, plus
// the total row count (unscoped of soft-deleted rows, which GORM filters out).
func GetAllInvitationCodes(startIdx int, num int) (codes []*InvitationCode, total int64, err error) {
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	if err = tx.Model(&InvitationCode{}).Count(&total).Error; err != nil {
		tx.Rollback()
		return nil, 0, err
	}
	if err = tx.Order("id desc").Limit(num).Offset(startIdx).Find(&codes).Error; err != nil {
		tx.Rollback()
		return nil, 0, err
	}
	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}
	return codes, total, nil
}

// SearchInvitationCodes filters by name prefix or exact code/id, like
// SearchRedemptions. Used by the admin list UI search box.
func SearchInvitationCodes(keyword string, startIdx int, num int) (codes []*InvitationCode, total int64, err error) {
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	query := tx.Model(&InvitationCode{})
	if id, atoiErr := strconv.Atoi(keyword); atoiErr == nil {
		query = query.Where("id = ? OR name LIKE ? OR code LIKE ?", id, keyword+"%", keyword+"%")
	} else {
		query = query.Where("name LIKE ? OR code LIKE ?", keyword+"%", keyword+"%")
	}
	if err = query.Count(&total).Error; err != nil {
		tx.Rollback()
		return nil, 0, err
	}
	if err = query.Order("id desc").Limit(num).Offset(startIdx).Find(&codes).Error; err != nil {
		tx.Rollback()
		return nil, 0, err
	}
	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}
	return codes, total, nil
}

// DeleteInvitationCode soft-deletes a code row. Already-consumed codes may be
// removed too — the bound user is unaffected (their registration stands).
func DeleteInvitationCode(id int) error {
	if id == 0 {
		return errors.New("id 为空！")
	}
	return DB.Delete(&InvitationCode{}, "id = ?", id).Error
}
