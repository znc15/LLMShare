package model

import (
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	ChannelBudgetKindHourly = "hourly"
	ChannelBudgetKindDaily  = "daily"
)

// ChannelBudget records a channel's quota spend within one fixed budget
// window (hourly aligned to :00, daily aligned to 00:00 local). The relay path
// reads these to decide whether a channel has hit its cap and should be
// skipped in favour of another (failover).
type ChannelBudget struct {
	Id           int       `json:"id" gorm:"primaryKey;autoIncrement"`
	ChannelId    int       `json:"channel_id" gorm:"not null;uniqueIndex:idx_ch_kind_window,priority:1;index"`
	WindowKind   string    `json:"window_kind" gorm:"type:varchar(8);not null;uniqueIndex:idx_ch_kind_window,priority:2"`
	WindowStart  time.Time `json:"window_start" gorm:"not null;uniqueIndex:idx_ch_kind_window,priority:3"`
	Spent        int64     `json:"spent" gorm:"type:bigint;default:0"`
	RequestCount int64     `json:"request_count" gorm:"type:bigint;default:0"`
}

func (ChannelBudget) TableName() string {
	return "channel_budgets"
}

// CurrentWindowStart returns the start of the current window for the given kind.
// Uses UTC deliberately: the go-sql-driver mysql DSN has no `loc=`, so it
// serializes time.Time values as UTC. Computing windows in UTC keeps reads and
// writes consistent regardless of the container/host timezone. Channel budget
// windows are thus aligned to UTC midnight and UTC hour boundaries.
func CurrentWindowStart(kind string) time.Time {
	now := time.Now().UTC()
	if kind == ChannelBudgetKindDaily {
		return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	}
	return time.Date(now.Year(), now.Month(), now.Day(), now.Hour(), 0, 0, 0, time.UTC)
}

// AddChannelSpend upserts the current window's bucket for a channel, adding
// `quota` to the spend and incrementing the request count. Called from the
// post-consume path once a relay settles.
func AddChannelSpend(channelId int, quota int64) error {
	if quota <= 0 {
		return nil
	}
	for _, kind := range []string{ChannelBudgetKindHourly, ChannelBudgetKindDaily} {
		start := CurrentWindowStart(kind)
		row := ChannelBudget{ChannelId: channelId, WindowKind: kind, WindowStart: start}
		if err := DB.Where("channel_id = ? AND window_kind = ? AND window_start = ?", channelId, kind, start).
			FirstOrCreate(&row, ChannelBudget{ChannelId: channelId, WindowKind: kind, WindowStart: start, Spent: 0}).Error; err != nil {
			return err
		}
		if err := DB.Model(&ChannelBudget{}).
			Where("channel_id = ? AND window_kind = ? AND window_start = ?", channelId, kind, start).
			Updates(map[string]interface{}{
				"spent":         gorm.Expr("spent + ?", quota),
				"request_count": gorm.Expr("request_count + ?", 1),
			}).Error; err != nil {
			return err
		}
	}
	return nil
}

// ChannelSpendResult is the current-window spend for a channel + kind.
type ChannelSpendResult struct {
	Spent int64 `gorm:"column:spent"`
}

// GetChannelWindowSpend returns the current spend for a channel in the
// specified window kind, or 0 if no bucket exists yet.
func GetChannelWindowSpend(channelId int, kind string) (int64, error) {
	start := CurrentWindowStart(kind)
	var res ChannelSpendResult
	err := DB.Model(&ChannelBudget{}).
		Select("spent").
		Where("channel_id = ? AND window_kind = ? AND window_start = ?", channelId, kind, start).
		Scan(&res).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return 0, nil
		}
		return 0, err
	}
	return res.Spent, nil
}

// ChannelBudgetRow is a flat view of a channel's current spend for the admin UI.
type ChannelBudgetRow struct {
	ChannelId    int       `json:"channel_id"`
	Name         string    `json:"name"`
	HourlySpent  int64     `json:"hourly_spent"`
	DailySpent   int64     `json:"daily_spent"`
	RequestCount int64     `json:"request_count"`
}

// AllChannelBudgets returns current-window spend joined to channel names for
// every channel, for the admin channel-budget view.
func AllChannelBudgets() ([]ChannelBudgetRow, error) {
	hourStart := CurrentWindowStart(ChannelBudgetKindHourly)
	dayStart := CurrentWindowStart(ChannelBudgetKindDaily)
	var rows []ChannelBudgetRow
	err := DB.Table("channels").
		Select(`channels.id as channel_id,
			channels.name as name,
			COALESCE(h.spent, 0) as hourly_spent,
			COALESCE(d.spent, 0) as daily_spent,
			COALESCE(d.request_count, 0) as request_count`).
		Joins("LEFT JOIN channel_budgets h ON h.channel_id = channels.id AND h.window_kind = 'hourly' AND h.window_start = ?", hourStart).
		Joins("LEFT JOIN channel_budgets d ON d.channel_id = channels.id AND d.window_kind = 'daily' AND d.window_start = ?", dayStart).
		Where("channels.status = ?", common.ChannelStatusEnabled).
		Scan(&rows).Error
	return rows, err
}
