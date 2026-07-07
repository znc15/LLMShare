package controller

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// invitationCodeCreateReq is the body for batch-generating invitation codes.
type invitationCodeCreateReq struct {
	Count      int    `json:"count"`
	Name       string `json:"name"`        // optional admin label
	ExpireDays int    `json:"expire_days"` // <= 0 means never expires
}

// GetAllInvitationCodes lists all codes (newest first), paginated.
func GetAllInvitationCodes(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	codes, total, err := model.GetAllInvitationCodes(pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(codes)
	common.ApiSuccess(c, pageInfo)
}

// SearchInvitationCodes filters codes by name/code/id prefix.
func SearchInvitationCodes(c *gin.Context) {
	keyword := c.Query("keyword")
	pageInfo := common.GetPageQuery(c)
	codes, total, err := model.SearchInvitationCodes(keyword, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(codes)
	common.ApiSuccess(c, pageInfo)
}

// AddInvitationCodes batch-generates codes. The generating admin's id is
// recorded on each row so usage can be audited later.
func AddInvitationCodes(c *gin.Context) {
	var req invitationCodeCreateReq
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.Count <= 0 {
		req.Count = 1
	}
	createdBy := c.GetInt("id")
	codes, err := model.GenerateInvitationCodes(req.Count, req.Name, createdBy, req.ExpireDays)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, codes)
}

// DeleteInvitationCode soft-deletes a single code. A consumed code may still be
// deleted — the registration that used it is unaffected.
func DeleteInvitationCode(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.DeleteInvitationCode(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// ExportInvitationCodes streams ALL codes as a CSV download. Unlike the paginated
// list (capped at page_size=100), this endpoint has no row limit so an operator
// can pull the full set for offline tracking or distribution. The status column
// is human-readable for easy filtering in spreadsheet apps.
func ExportInvitationCodes(c *gin.Context) {
	// Reuse GetAllInvitationCodes with a large offset window. Codes are a small
	// dataset (single-batch generation caps at 1000), so fetching all into one
	// page is safe; there is no upper-clamp in GetAllInvitationCodes itself.
	codes, _, err := model.GetAllInvitationCodes(0, 100000)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	statusName := func(s int) string {
		switch s {
		case model.InvitationCodeStatusUnused:
			return "unused"
		case model.InvitationCodeStatusUsed:
			return "used"
		default:
			return fmt.Sprintf("status_%d", s)
		}
	}
	formatTime := func(ts int64) string {
		if ts == 0 {
			return ""
		}
		return time.Unix(ts, 0).UTC().Format("2006-01-02 15:04:05 UTC")
	}

	// BOM (\xEF\xBB\xBF) makes Excel open UTF-8 correctly; CRLF keeps Windows
	// spreadsheet apps happy.
	header := "\xEF\xBB\xBFid,code,name,status,created_user_id,used_user_id,created_time,used_time,expired_time\r\n"
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="invitation_codes_%s.csv"`, time.Now().UTC().Format("20060102_150405")))
	c.Status(http.StatusOK)
	_, _ = c.Writer.WriteString(header)
	for _, code := range codes {
		row := fmt.Sprintf("%d,%s,%s,%s,%d,%d,%s,%s,%s\r\n",
			code.Id,
			csvField(code.Code),
			csvField(code.Name),
			statusName(code.Status),
			code.CreatedUserId,
			code.UsedUserId,
			formatTime(code.CreatedTime),
			formatTime(code.UsedTime),
			formatTime(code.ExpiredTime),
		)
		_, _ = c.Writer.WriteString(row)
	}
}

// csvField quotes a field for CSV if it contains characters that require it
// (comma, quote, CR/LF). The code/name fields are admin-controlled and unlikely
// to contain these, but quoting defensively avoids corruption when they do.
func csvField(s string) string {
	if s == "" {
		return ""
	}
	needsQuote := false
	for _, r := range s {
		if r == ',' || r == '"' || r == '\r' || r == '\n' {
			needsQuote = true
			break
		}
	}
	if !needsQuote {
		return s
	}
	// RFC 4180: double up any embedded quotes, wrap in quotes.
	out := make([]byte, 0, len(s)+2)
	out = append(out, '"')
	for i := 0; i < len(s); i++ {
		if s[i] == '"' {
			out = append(out, '"', '"')
		} else {
			out = append(out, s[i])
		}
	}
	out = append(out, '"')
	return string(out)
}
