package service

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/system_setting"
)

// SendRegistrationSuccessEmail sends the "welcome, your account is ready" email
// when a new user account is created. Best-effort: callers fire it via gopool
// and ignore the error. Skipped when the SMTP server is not configured
// (common.SendEmail returns an error in that case, which is fine to drop).
func SendRegistrationSuccessEmail(email string) error {
	subject := "注册成功 / Welcome to " + common.SystemName
	baseURL := strings.TrimRight(system_setting.ServerAddress, "/")
	content := fmt.Sprintf(`
<div style="max-width:560px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#333;">
  <h2 style="color:#1a1a1a;">注册成功 🎉</h2>
  <p>您好，</p>
  <p>欢迎加入 <strong>%s</strong>！您的账号已创建成功，现在可以开始使用了。</p>
  <p style="margin:24px 0;">
    <a href="%s" style="display:inline-block;padding:12px 28px;background:#337ab7;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">点击登录</a>
  </p>
  <p>或复制以下链接到浏览器登录：</p>
  <p style="word-break:break-all;color:#337ab7;">%s</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
  <p style="color:#888;font-size:13px;">如果您没有注册过，请忽略此邮件。</p>
  <p style="color:#888;font-size:13px;">Welcome to <strong>%s</strong>! Your account has been created successfully and is ready to use. Click the button above to sign in.</p>
</div>`, common.SystemName, baseURL, baseURL, common.SystemName)
	return common.SendEmail(subject, email, content)
}
