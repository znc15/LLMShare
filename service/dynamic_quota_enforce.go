package service

import (
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
)

// centsToQuota converts a USD-cents amount to NewAPI's internal quota unit.
// 1 USD = 100 cents = QuotaPerUnit quota, so 1 cent = QuotaPerUnit / 100.
func centsToQuota(cents int64) int64 {
	if cents <= 0 {
		return 0
	}
	return int64(float64(cents) * common.QuotaPerUnit / 100.0)
}

// QuotaToCents is the reverse conversion, for displaying quota as USD in APIs/UI.
func QuotaToCents(quota int64) int64 {
	if common.QuotaPerUnit == 0 {
		return 0
	}
	return int64(float64(quota) / common.QuotaPerUnit * 100.0)
}

// CheckUserHourlyQuota enforces a user's dynamic hourly quota. It rejects with
// 429 if the user's settled in-hour spend (HourUsed) has reached their
// HourlyQuota. In-flight reservations are already handled by NewAPI's
// pre-consume billing on the user's wallet, so this is the secondary,
// quota-pool-specific gate.
//
// Returns a 429 NewAPIError to abort the request, or nil to proceed.
func CheckUserHourlyQuota(userId int) *types.NewAPIError {
	if !common.DynamicQuotaEnabled {
		return nil
	}
	dq, err := model.GetDynamicQuota(userId)
	if err != nil || dq == nil {
		// No dynamic-quota row yet — let the request through; the user will be
		// seeded by promotion or the next tick. We do not want to lock out
		// pre-existing users before the first allocation runs.
		return nil
	}
	if dq.HourlyQuota <= 0 {
		return quotaExceededError()
	}
	if dq.HourUsed >= dq.HourlyQuota {
		return quotaExceededError()
	}
	return nil
}

func quotaExceededError() *types.NewAPIError {
	return types.NewErrorWithStatusCode(
		fmt.Errorf("hourly quota exceeded"),
		types.ErrorCodeInsufficientUserQuota,
		429,
	)
}

// SettleDynamicQuota records a settled relay's cost against the user's hourly
// spend bucket and their dynamic-quota HourUsed counter, and refreshes the
// last-request timestamp (which drives eviction). Also records the spend
// against the channel's budget window. Called from PostConsumeQuota.
func SettleDynamicQuota(relayInfo *relaycommon.RelayInfo, quota int, channelId int) {
	userId := relayInfo.UserId
	if quota < 0 {
		quota = -quota // refunds are rare; treat magnitude as spend for accounting
	}
	q := int64(quota)
	if common.DynamicQuotaEnabled && userId > 0 {
		if err := model.AddUserSpendBucket(userId, q); err != nil {
			common.SysError("failed to record user spend bucket: " + err.Error())
		}
		if err := model.IncrementDynamicQuotaUsage(userId, q); err != nil {
			common.SysError("failed to increment dynamic quota usage: " + err.Error())
		}
	}
	if channelId > 0 {
		RecordChannelSpend(channelId, q)
	}
}
