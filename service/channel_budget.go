package service

import (
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/types"
)

// exhaustedChannels is an in-memory set of channel ids known to have hit their
// budget cap in the current window. It lets the pre-relay check fail over
// instantly without hitting the DB on every request. The hourly tick clears
// stale entries when a window boundary rolls over. Correctness does not depend
// on this cache — it is only an optimization; the authoritative check still
// reads the DB.
var exhaustedChannels = struct {
	sync.RWMutex
	m map[int]struct{}
}{m: make(map[int]struct{})}

// MarkChannelExhausted caches a channel as budget-exhausted for fast failover.
func MarkChannelExhausted(channelId int) {
	exhaustedChannels.Lock()
	exhaustedChannels.m[channelId] = struct{}{}
	exhaustedChannels.Unlock()
}

// ClearChannelExhausted removes a channel from the exhausted cache (used by the
// hourly tick when the window rolls over).
func ClearChannelExhausted(channelId int) {
	exhaustedChannels.Lock()
	delete(exhaustedChannels.m, channelId)
	exhaustedChannels.Unlock()
}

// ClearAllExhaustedChannels wipes the cache (used by the tick at window rollover).
func ClearAllExhaustedChannels() {
	exhaustedChannels.Lock()
	exhaustedChannels.m = make(map[int]struct{})
	exhaustedChannels.Unlock()
}

func isChannelExhaustedCached(channelId int) bool {
	exhaustedChannels.RLock()
	_, ok := exhaustedChannels.m[channelId]
	exhaustedChannels.RUnlock()
	return ok
}

// CheckChannelBudget returns a retriable channel error if the given channel has
// exceeded its configured budget cap for the current window. Called from the
// relay retry loop right after a channel is selected, before the request is
// forwarded. Returning a channel error makes the relay fail over to the next
// channel; if no channel remains, the user sees 429.
func CheckChannelBudget(channelId int) *types.NewAPIError {
	if channelId <= 0 {
		return nil
	}
	// Fast path: cached exhaustion.
	if isChannelExhaustedCached(channelId) {
		return budgetExceededError()
	}
	// Single cap over a selected period (daily or hourly). 0 = no cap.
	if common.ChannelBudgetCap > 0 {
		kind := activeChannelKind()
		spent, err := model.GetChannelWindowSpend(channelId, kind)
		if err == nil && spent >= centsToQuota(int64(common.ChannelBudgetCap)) {
			MarkChannelExhausted(channelId)
			return budgetExceededError()
		}
	}
	return nil
}

// RecordChannelSpend records the settled cost of a relay against the channel's
// budget window. Called from PostConsumeQuota after the user's wallet is
// charged. If the recording pushes the channel over a cap, it is marked
// exhausted so subsequent requests fail over immediately.
func RecordChannelSpend(channelId int, quota int64) {
	if channelId <= 0 || quota <= 0 {
		return
	}
	if err := model.AddChannelSpend(channelId, quota); err != nil {
		common.SysError("failed to record channel spend: " + err.Error())
		return
	}
	// Re-check the active-period cap and cache exhaustion for fast failover.
	if common.ChannelBudgetCap > 0 {
		kind := activeChannelKind()
		if spent, err := model.GetChannelWindowSpend(channelId, kind); err == nil &&
			spent >= centsToQuota(int64(common.ChannelBudgetCap)) {
			MarkChannelExhausted(channelId)
		}
	}
}

// activeChannelKind returns the budget window kind matching the configured
// period (default daily).
func activeChannelKind() string {
	if common.ChannelBudgetCapPeriod == "hourly" {
		return model.ChannelBudgetKindHourly
	}
	return model.ChannelBudgetKindDaily
}

func budgetExceededError() *types.NewAPIError {
	return types.NewErrorWithStatusCode(
		nil,
		types.ErrorCodeChannelBudgetExceeded,
		429,
	)
}
