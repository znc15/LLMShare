package middleware

import (
	"net/http"

	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// DynamicQuotaCheck enforces each user's dynamic hourly quota before a relay
// proceeds. It is a no-op when DynamicQuotaEnabled is false. Inserted into the
// relay middleware chain after TokenAuth (so the user id is known) and before
// Distribute. On exhaustion it returns 429 with an OpenAI-style error body so
// existing clients interpret it as "balance insufficient".
func DynamicQuotaCheck() gin.HandlerFunc {
	return func(c *gin.Context) {
		userId := c.GetInt("id")
		if userId == 0 {
			c.Next()
			return
		}
		if err := service.CheckUserHourlyQuota(userId); err != nil {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error": gin.H{
					"message": "余额不足，您本小时的动态额度已用尽 (insufficient balance: hourly dynamic quota exhausted)",
					"type":    "new_api_error",
					"code":    "insufficient_user_quota",
				},
			})
			c.Abort()
			return
		}
		c.Next()
	}
}
