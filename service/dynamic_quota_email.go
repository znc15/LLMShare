package service

import (
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/system_setting"
)

// MagicLinkExpiry returns the expiry time for a newly issued magic link.
func MagicLinkExpiry() time.Time {
	return time.Now().Add(time.Duration(common.MagicLinkTTLHours) * time.Hour)
}

// SendWaitlistConfirmationEmail sends the "you're #N in line" email when a
// person joins the waitlist (template 1).
func SendWaitlistConfirmationEmail(email string, position int) error {
	subject := "排队成功 / You're on the waitlist"
	baseURL := strings.TrimRight(system_setting.ServerAddress, "/")
	content := fmt.Sprintf(`
<div style="max-width:560px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#333;">
  <h2 style="color:#1a1a1a;">您已加入候补名单 🎉</h2>
  <p>您好，</p>
  <p>您已成功加入 <strong>%s</strong> 的候补名单。当前排队位置：<strong>#%d</strong>。</p>
  <p>当有名额释放时，系统会按到达顺序自动提升队列前方的用户，并向您发送一封包含激活链接的邮件。激活链接有效期为 24 小时。</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
  <p style="color:#888;font-size:13px;">这是系统自动发送的邮件，请勿直接回复。</p>
  <p style="color:#888;font-size:13px;">You joined the waitlist for <strong>%s</strong>. Your current position is <strong>#%d</strong>. You'll receive a magic-link email when a slot opens.</p>
</div>`, common.SystemName, position, common.SystemName, position)
	if baseURL != "" {
		content = strings.ReplaceAll(content, "</div>", fmt.Sprintf(`<p style="margin-top:24px;"><a href="%s" style="color:#337ab7;">%s</a></p></div>`, baseURL, baseURL))
	}
	return common.SendEmail(subject, email, content)
}

// SendPromotionEmail sends the magic-link activation email to a promoted
// waitlist user (template 2). The token is consumed at /activate?token=...
func SendPromotionEmail(email, token string, expiresAt interface{}) error {
	subject := "名额已释放，请激活您的账号 / Your slot is ready"
	baseURL := strings.TrimRight(system_setting.ServerAddress, "/")
	if baseURL == "" {
		baseURL = "https://your-domain.example"
	}
	link := fmt.Sprintf("%s/activate?token=%s", baseURL, token)
	expStr := fmt.Sprintf("%v", expiresAt)
	content := fmt.Sprintf(`
<div style="max-width:560px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#333;">
  <h2 style="color:#1a1a1a;">恭喜，您的名额已就绪 🎉</h2>
  <p>您好，</p>
  <p>您在 <strong>%s</strong> 候补名单中的名额已释放，现在可以激活您的账号。</p>
  <p style="margin:24px 0;">
    <a href="%s" style="display:inline-block;padding:12px 28px;background:#337ab7;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">点击激活账号</a>
  </p>
  <p>或复制以下链接到浏览器：</p>
  <p style="word-break:break-all;color:#337ab7;">%s</p>
  <p style="color:#c0392b;"><strong>注意：</strong>该激活链接将在 <strong>%s</strong> 后失效。若未及时激活，名额将释放给下一位排队者。</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
  <p style="color:#888;font-size:13px;">如果您没有注册过，请忽略此邮件。</p>
  <p style="color:#888;font-size:13px;">Your slot on the <strong>%s</strong> waitlist is ready. Click the button above to activate. The link expires at <strong>%s</strong>.</p>
</div>`, common.SystemName, link, link, expStr, common.SystemName, expStr)
	return common.SendEmail(subject, email, content)
}

// SendEvictionEmail sends the inactivity-eviction notice (template 3).
// Best-effort: the user has already been hard-deleted, so this may bounce.
func SendEvictionEmail(email string) error {
	subject := "账号已因长期未使用被移除 / Account removed for inactivity"
	days := common.InactivityThresholdDays
	content := fmt.Sprintf(`
<div style="max-width:560px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#333;">
  <h2 style="color:#1a1a1a;">账号已移除</h2>
  <p>您好，</p>
  <p>由于您在最近 <strong>%d</strong> 天内未发起任何请求，您在 <strong>%s</strong> 的账号（含所有数据）已被自动移除，名额已释放给下一位排队者。</p>
  <p>如需继续使用，欢迎重新加入候补名单。</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
  <p style="color:#888;font-size:13px;">Your account at <strong>%s</strong> was removed after %d days of inactivity, and your slot was freed. You may rejoin the waitlist if you wish to use the service again.</p>
</div>`, days, common.SystemName, common.SystemName, days)
	return common.SendEmail(subject, email, content)
}
