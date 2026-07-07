package controller

import (
	"strconv"

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
