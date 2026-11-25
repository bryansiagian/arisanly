package groups

import (
	"encoding/json"
	"net/http"

	"github.com/bryansiagian/arisanly/apps/api/internal/auth"
)

func (h handler) rounds(w http.ResponseWriter, r *http.Request) {
	group, ok := uuidParam(w, r, "id")
	if !ok {
		return
	}
	var result json.RawMessage
	err := h.db.QueryRow(r.Context(), `
		WITH latest AS (SELECT * FROM arisanly.cycles WHERE group_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1)
		SELECT jsonb_build_object(
			'cycle', (SELECT jsonb_build_object('id',id,'closed',closed_at IS NOT NULL,
				'amount',amount::text,'method',order_method,'frequency',frequency) FROM latest),
			'rounds', coalesce((
				SELECT jsonb_agg(jsonb_build_object(
					'id',r.id,'number',r.number,'dueDate',r.due_date,'status',r.status,'recipientId',r.recipient_user_id,
					'recipientName',(SELECT name FROM arisanly.users WHERE id=r.recipient_user_id),
					'obligations',coalesce((
						SELECT jsonb_agg(jsonb_build_object(
							'id',o.id,'memberId',o.member_user_id,'name',u.name,'amount',o.amount_due::text,
							'claimId',p.id,'claimStatus',p.status,'note',p.note
						) ORDER BY u.name,o.id)
						FROM arisanly.obligations o JOIN arisanly.users u ON u.id=o.member_user_id
						LEFT JOIN LATERAL (
							SELECT id,status,note FROM arisanly.payment_claims
							WHERE obligation_id=o.id ORDER BY created_at DESC,id DESC LIMIT 1
						) p ON true WHERE o.round_id=r.id
					),'[]'::jsonb)
				) ORDER BY r.number DESC)
				FROM arisanly.rounds r JOIN latest c ON c.id=r.cycle_id
			),'[]'::jsonb)
		)
		FROM arisanly.group_members WHERE group_id=$1 AND user_id=$2`, group, auth.UserID(r.Context())).Scan(&result)
	if err != nil {
		queryError(w, err)
		return
	}
	reply(w, 200, result)
}

func (h handler) auditLog(w http.ResponseWriter, r *http.Request) {
	group, ok := uuidParam(w, r, "id")
	if !ok {
		return
	}
	var result json.RawMessage
	err := h.db.QueryRow(r.Context(), `
		SELECT coalesce((
			SELECT jsonb_agg(jsonb_build_object('id',a.id::text,'action',a.action,'actor',u.name,
				'details',a.details,'createdAt',a.created_at) ORDER BY a.id DESC)
			FROM arisanly.audit_log a JOIN arisanly.users u ON u.id=a.actor_user_id WHERE a.group_id=$1
		),'[]'::jsonb)
		FROM arisanly.group_members WHERE group_id=$1 AND user_id=$2`, group, auth.UserID(r.Context())).Scan(&result)
	if err != nil {
		queryError(w, err)
		return
	}
	reply(w, 200, result)
}
