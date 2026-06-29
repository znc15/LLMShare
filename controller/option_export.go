package controller

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// ExportOptionsAdmin returns ALL options as a downloadable JSON file. This is a
// full configuration snapshot for backup/transfer. Admin-only.
func ExportOptionsAdmin(c *gin.Context) {
	options, err := model.GetAllOptions()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// Build a plain map for clean JSON (drop the row id, keep key->value).
	out := make(map[string]string, len(options))
	for _, o := range options {
		out[o.Key] = o.Value
	}
	payload := gin.H{
		"exported_at": time.Now().Format(time.RFC3339),
		"version":     common.Version,
		"options":     out,
	}
	body, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.Header("Content-Disposition", "attachment; filename=newapi-options-"+time.Now().Format("20060102-150405")+".json")
	c.Data(http.StatusOK, "application/json", body)
}

// ImportOptionsAdmin accepts an exported options JSON (multipart or raw body)
// and applies key/value pairs via model.UpdateOption. Admin-only. Only existing
// keys are applied; unknown keys are skipped (reported in the response).
func ImportOptionsAdmin(c *gin.Context) {
	var payload struct {
		Options map[string]string `json:"options"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		common.ApiErrorMsg(c, "无效的导入文件 / invalid import file")
		return
	}
	applied := 0
	skipped := []string{}
	for k, v := range payload.Options {
		if err := model.UpdateOption(k, v); err != nil {
			skipped = append(skipped, k)
			continue
		}
		applied++
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"applied": applied,
			"skipped": skipped,
		},
		"message": "导入完成",
	})
}
