// lib/jobs/gems.db-contract.qa.fixtures.ts — ผลลัพธ์ RPC 0190 จริงที่จับจากฐานข้อมูล (QA R2-D2 22 ต.ค. 69 · verify-0190-qa-ui.sql · ร้านสังเคราะห์ "ZZ TEST" ที่ถูก ROLLBACK ทั้งก้อน)
// ใช้เป็นข้อมูลเข้าของ mapper ฝั่ง TS ใน gems.db-contract.qa.test.ts — ไม่มีข้อมูลจริงของร้าน (ราคาเป็นเลขทดสอบ 7391.2468 / 7000)
/* eslint-disable */
export const FX: Record<string, any> = {
 "job_gem_bom_get": {
  "job": {
   "id": "f163ef1b-48eb-42f7-bca0-c117c460cc68",
   "job_no": "JB-0002",
   "status": "open",
   "product_id": "e868104b-e688-4eeb-ab92-a2052f26557b",
   "qty_planned": 35
  },
  "lines": [
   {
    "id": "dfb28013-6076-4694-b359-489e6c330d6a",
    "via": "office",
    "label": "ZZUI โกเมน · ไข่ · 4×6 มม.",
    "source": "manual",
    "renamed": false,
    "position": "บ่าซ้าย-ขวา",
    "qty_total": 70,
    "created_at": "2026-10-22T14:26:20.246863+00:00",
    "gem_item_id": "e94212fb-e041-4ed1-b1e4-f64562dbf5d7",
    "qty_per_piece": 2,
    "canonical_item_id": "e94212fb-e041-4ed1-b1e4-f64562dbf5d7"
   },
   {
    "id": "44b69359-8134-432c-b2e7-520c3feead4f",
    "via": "office",
    "label": "ZZUI CZ · กลม · 1.5 มม.",
    "source": "manual",
    "renamed": false,
    "position": null,
    "qty_total": 1050,
    "created_at": "2026-10-22T14:26:20.246863+00:00",
    "gem_item_id": "ea6c2c78-a4bf-4d23-ae2b-5a5b70c93d7c",
    "qty_per_piece": 30,
    "canonical_item_id": "ea6c2c78-a4bf-4d23-ae2b-5a5b70c93d7c"
   }
  ],
  "state": "specified",
  "window": "free_before_start",
  "history": [
   {
    "at": "2026-10-22T14:26:20.695188+00:00",
    "actor": "00000000-0000-0000-0000-0000000000a1",
    "after": [
     {
      "label": "ZZUI โกเมน · ไข่ · 4×6 มม.",
      "position": "บ่าซ้าย-ขวา",
      "qty_per_piece": 2
     },
     {
      "label": "ZZUI CZ · กลม · 1.5 มม.",
      "position": null,
      "qty_per_piece": 30
     }
    ],
    "phase": "create",
    "before": [],
    "reason": null,
    "source": "manual",
    "worker_id": null
   }
  ],
  "template": [],
  "gem_stage": "pending",
  "differs_from_template": true
 },
 "create_res": {
  "metal": "silver",
  "job_id": "f163ef1b-48eb-42f7-bca0-c117c460cc68",
  "job_no": "JB-0002",
  "status": "open",
  "warnings": [],
  "gem_lines": 2,
  "has_weigh": true,
  "qty_order": 35,
  "gem_source": "input",
  "profile_id": "f7f428bc-dfe5-4901-b07e-64ff0f4f1d6a",
  "gem_summary": {
   "reused": [],
   "merged_rows": [],
   "created_items": [
    {
     "id": "e94212fb-e041-4ed1-b1e4-f64562dbf5d7",
     "row": 1
    },
    {
     "id": "ea6c2c78-a4bf-4d23-ae2b-5a5b70c93d7c",
     "row": 2
    }
   ],
   "created_types": [
    {
     "id": "e9b8154d-269a-4fe6-b0da-955ed3653cc1",
     "name": "ZZUI โกเมน"
    },
    {
     "id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
     "name": "ZZUI CZ"
    }
   ],
   "created_shapes": []
  },
  "qty_planned": 35,
  "stage_codes": [
   "wax_inject",
   "wax_tree",
   "invest_burnout",
   "cast",
   "cut_sprue",
   "finish",
   "buff",
   "gem_set",
   "qc",
   "pack"
  ],
  "metal_plan_g": null,
  "plan_missing": [],
  "profile_name": "แบบ 1 — ชั่งเฉพาะหล่อ",
  "under_planned": false,
  "gold_unguarded": false,
  "start_gate_note_set": false
 },
 "similar_err": {
  "_err": "พบชื่อพลอยที่คล้ายกับที่มีอยู่แล้ว — ใช้ตัวที่มี หรือยืนยันเพิ่มเป็นชื่อใหม่",
  "_hint": "gem_similar",
  "_state": "22023",
  "_detail": "{\"similar\": [{\"kind\": \"type\", \"name\": \"ZZUI โกเมนต์\", \"rows\": [3], \"matches\": [{\"id\": \"e9b8154d-269a-4fe6-b0da-955ed3653cc1\", \"name\": \"ZZUI โกเมน\"}]}]}",
  "_detail_obj": {
   "similar": [
    {
     "kind": "type",
     "name": "ZZUI โกเมนต์",
     "rows": [
      3
     ],
     "matches": [
      {
       "id": "e9b8154d-269a-4fe6-b0da-955ed3653cc1",
       "name": "ZZUI โกเมน"
      }
     ]
    }
   ]
  }
 },
 "job_gem_bom_get_after_edit": {
  "job": {
   "id": "a568c1f8-83ae-49b8-be84-f3706c32b756",
   "job_no": "JB-0003",
   "status": "in_progress",
   "product_id": "e868104b-e688-4eeb-ab92-a2052f26557b",
   "qty_planned": 10
  },
  "lines": [
   {
    "id": "6a402b8c-b8f4-4aeb-85eb-744d59c85df7",
    "via": "office",
    "label": "ZZUI โกเมน · ไข่ · 4×6 มม.",
    "source": "manual",
    "renamed": false,
    "position": null,
    "qty_total": 110,
    "created_at": "2026-10-22T14:26:20.246863+00:00",
    "gem_item_id": "e94212fb-e041-4ed1-b1e4-f64562dbf5d7",
    "qty_per_piece": 11,
    "canonical_item_id": "e94212fb-e041-4ed1-b1e4-f64562dbf5d7"
   },
   {
    "id": "3018daa2-5c56-421f-a9e2-0c93cfe3b47f",
    "via": "office",
    "label": "ZZUI CZ · กลม · 1.5 มม.",
    "source": "manual",
    "renamed": false,
    "position": null,
    "qty_total": 300,
    "created_at": "2026-10-22T14:26:20.246863+00:00",
    "gem_item_id": "ea6c2c78-a4bf-4d23-ae2b-5a5b70c93d7c",
    "qty_per_piece": 30,
    "canonical_item_id": "ea6c2c78-a4bf-4d23-ae2b-5a5b70c93d7c"
   }
  ],
  "state": "specified",
  "window": "reason_required",
  "history": [
   {
    "at": "2026-10-22T14:26:21.148851+00:00",
    "actor": "58e3c736-a85e-4cee-9b37-d4497ca3e1b1",
    "after": [
     {
      "label": "ZZUI โกเมน · ไข่ · 4×6 มม.",
      "position": null,
      "qty_per_piece": 11
     },
     {
      "label": "ZZUI CZ · กลม · 1.5 มม.",
      "position": null,
      "qty_per_piece": 30
     }
    ],
    "phase": "reason_required",
    "before": [
     {
      "label": "ZZUI โกเมน · ไข่ · 4×6 มม.",
      "position": null,
      "qty_per_piece": 10
     },
     {
      "label": "ZZUI CZ · กลม · 1.5 มม.",
      "position": null,
      "qty_per_piece": 30
     }
    ],
    "reason": "๑",
    "source": "manual",
    "worker_id": null
   },
   {
    "at": "2026-10-22T14:26:21.142659+00:00",
    "actor": "58e3c736-a85e-4cee-9b37-d4497ca3e1b1",
    "after": [
     {
      "label": "ZZUI โกเมน · ไข่ · 4×6 มม.",
      "position": null,
      "qty_per_piece": 10
     },
     {
      "label": "ZZUI CZ · กลม · 1.5 มม.",
      "position": null,
      "qty_per_piece": 30
     }
    ],
    "phase": "reason_required",
    "before": [
     {
      "label": "ZZUI โกเมน · ไข่ · 4×6 มม.",
      "position": null,
      "qty_per_piece": 9
     },
     {
      "label": "ZZUI CZ · กลม · 1.5 มม.",
      "position": null,
      "qty_per_piece": 30
     }
    ],
    "reason": "12",
    "source": "manual",
    "worker_id": null
   },
   {
    "at": "2026-10-22T14:26:21.135561+00:00",
    "actor": "58e3c736-a85e-4cee-9b37-d4497ca3e1b1",
    "after": [
     {
      "label": "ZZUI โกเมน · ไข่ · 4×6 มม.",
      "position": null,
      "qty_per_piece": 9
     },
     {
      "label": "ZZUI CZ · กลม · 1.5 มม.",
      "position": null,
      "qty_per_piece": 30
     }
    ],
    "phase": "reason_required",
    "before": [
     {
      "label": "ZZUI โกเมน · ไข่ · 4×6 มม.",
      "position": null,
      "qty_per_piece": 8
     },
     {
      "label": "ZZUI CZ · กลม · 1.5 มม.",
      "position": null,
      "qty_per_piece": 30
     }
    ],
    "reason": "ครับ!",
    "source": "manual",
    "worker_id": null
   },
   {
    "at": "2026-10-22T14:26:21.12633+00:00",
    "actor": "58e3c736-a85e-4cee-9b37-d4497ca3e1b1",
    "after": [
     {
      "label": "ZZUI โกเมน · ไข่ · 4×6 มม.",
      "position": null,
      "qty_per_piece": 8
     },
     {
      "label": "ZZUI CZ · กลม · 1.5 มม.",
      "position": null,
      "qty_per_piece": 30
     }
    ],
    "phase": "reason_required",
    "before": [
     {
      "label": "ZZUI โกเมน · ไข่ · 4×6 มม.",
      "position": null,
      "qty_per_piece": 7
     },
     {
      "label": "ZZUI CZ · กลม · 1.5 มม.",
      "position": null,
      "qty_per_piece": 30
     }
    ],
    "reason": "เติมพลอยเพิ่ม 1 เม็ด",
    "source": "manual",
    "worker_id": null
   },
   {
    "at": "2026-10-22T14:26:21.116302+00:00",
    "actor": "58e3c736-a85e-4cee-9b37-d4497ca3e1b1",
    "after": [
     {
      "label": "ZZUI โกเมน · ไข่ · 4×6 มม.",
      "position": null,
      "qty_per_piece": 7
     },
     {
      "label": "ZZUI CZ · กลม · 1.5 มม.",
      "position": null,
      "qty_per_piece": 30
     }
    ],
    "phase": "reason_required",
    "before": [
     {
      "label": "ZZUI โกเมน · ไข่ · 4×6 มม.",
      "position": null,
      "qty_per_piece": 6
     },
     {
      "label": "ZZUI CZ · กลม · 1.5 มม.",
      "position": null,
      "qty_per_piece": 30
     }
    ],
    "reason": "กกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกก",
    "source": "manual",
    "worker_id": null
   },
   {
    "at": "2026-10-22T14:26:21.103901+00:00",
    "actor": "58e3c736-a85e-4cee-9b37-d4497ca3e1b1",
    "after": [
     {
      "label": "ZZUI โกเมน · ไข่ · 4×6 มม.",
      "position": null,
      "qty_per_piece": 6
     },
     {
      "label": "ZZUI CZ · กลม · 1.5 มม.",
      "position": null,
      "qty_per_piece": 30
     }
    ],
    "phase": "reason_required",
    "before": [
     {
      "label": "ZZUI โกเมน · ไข่ · 4×6 มม.",
      "position": null,
      "qty_per_piece": 5
     },
     {
      "label": "ZZUI CZ · กลม · 1.5 มม.",
      "position": null,
      "qty_per_piece": 30
     }
    ],
    "reason": "a️",
    "source": "manual",
    "worker_id": null
   },
   {
    "at": "2026-10-22T14:26:21.094303+00:00",
    "actor": "58e3c736-a85e-4cee-9b37-d4497ca3e1b1",
    "after": [
     {
      "label": "ZZUI โกเมน · ไข่ · 4×6 มม.",
      "position": null,
      "qty_per_piece": 5
     },
     {
      "label": "ZZUI CZ · กลม · 1.5 มม.",
      "position": null,
      "qty_per_piece": 30
     }
    ],
    "phase": "reason_required",
    "before": [
     {
      "label": "ZZUI โกเมน · ไข่ · 4×6 มม.",
      "position": null,
      "qty_per_piece": 4
     },
     {
      "label": "ZZUI CZ · กลม · 1.5 มม.",
      "position": null,
      "qty_per_piece": 30
     }
    ],
    "reason": "ok",
    "source": "manual",
    "worker_id": null
   },
   {
    "at": "2026-10-22T14:26:21.085842+00:00",
    "actor": "58e3c736-a85e-4cee-9b37-d4497ca3e1b1",
    "after": [
     {
      "label": "ZZUI โกเมน · ไข่ · 4×6 มม.",
      "position": null,
      "qty_per_piece": 4
     },
     {
      "label": "ZZUI CZ · กลม · 1.5 มม.",
      "position": null,
      "qty_per_piece": 30
     }
    ],
    "phase": "reason_required",
    "before": [
     {
      "label": "ZZUI โกเมน · ไข่ · 4×6 มม.",
      "position": null,
      "qty_per_piece": 3
     },
     {
      "label": "ZZUI CZ · กลม · 1.5 มม.",
      "position": null,
      "qty_per_piece": 30
     }
    ],
    "reason": "ก",
    "source": "manual",
    "worker_id": null
   },
   {
    "at": "2026-10-22T14:26:21.076051+00:00",
    "actor": "58e3c736-a85e-4cee-9b37-d4497ca3e1b1",
    "after": [
     {
      "label": "ZZUI โกเมน · ไข่ · 4×6 มม.",
      "position": null,
      "qty_per_piece": 3
     },
     {
      "label": "ZZUI CZ · กลม · 1.5 มม.",
      "position": null,
      "qty_per_piece": 30
     }
    ],
    "phase": "reason_required",
    "before": [
     {
      "label": "ZZUI โกเมน · ไข่ · 4×6 มม.",
      "position": null,
      "qty_per_piece": 2
     },
     {
      "label": "ZZUI CZ · กลม · 1.5 มม.",
      "position": null,
      "qty_per_piece": 30
     }
    ],
    "reason": "0",
    "source": "manual",
    "worker_id": null
   },
   {
    "at": "2026-10-22T14:26:20.927618+00:00",
    "actor": "00000000-0000-0000-0000-0000000000a1",
    "after": [
     {
      "label": "ZZUI โกเมน · ไข่ · 4×6 มม.",
      "position": null,
      "qty_per_piece": 2
     },
     {
      "label": "ZZUI CZ · กลม · 1.5 มม.",
      "position": null,
      "qty_per_piece": 30
     }
    ],
    "phase": "create",
    "before": [],
    "reason": null,
    "source": "manual",
    "worker_id": null
   }
  ],
  "template": [],
  "gem_stage": "started",
  "differs_from_template": true
 },
 "worker_resolve": {
  "ok": true,
  "job": {
   "sku": "ZZ190-A3",
   "gems": [
    {
     "label": "ZZUI โกเมน · ไข่ · 4×6 มม.",
     "position": null,
     "qty_total": 110,
     "qty_per_piece": 11
    },
    {
     "label": "ZZUI CZ · กลม · 1.5 มม.",
     "position": null,
     "qty_total": 300,
     "qty_per_piece": 30
    }
   ],
   "metal": "silver",
   "job_no": "JB-0003",
   "stages": [
    {
     "seq": 1,
     "code": "wax_inject",
     "name": "ฉีดเทียน",
     "status": "sent",
     "sent_on": "2026-10-22",
     "auto_closed": false,
     "received_on": "2026-10-22",
     "worker_name": "x"
    },
    {
     "seq": 2,
     "code": "wax_tree",
     "name": "ติดต้นเทียน",
     "status": "sent",
     "sent_on": "2026-10-22",
     "auto_closed": false,
     "received_on": "2026-10-22",
     "worker_name": "x"
    },
    {
     "seq": 3,
     "code": "invest_burnout",
     "name": "ปั่นปูน เทปูน เผา",
     "status": "sent",
     "sent_on": "2026-10-22",
     "auto_closed": false,
     "received_on": "2026-10-22",
     "worker_name": "x"
    },
    {
     "seq": 4,
     "code": "cast",
     "name": "หล่อ",
     "status": "sent",
     "sent_on": "2026-10-22",
     "auto_closed": false,
     "received_on": "2026-10-22",
     "worker_name": "x"
    },
    {
     "seq": 5,
     "code": "cut_sprue",
     "name": "ตัดต้น",
     "status": "sent",
     "sent_on": "2026-10-22",
     "auto_closed": false,
     "received_on": "2026-10-22",
     "worker_name": "x"
    },
    {
     "seq": 6,
     "code": "finish",
     "name": "แต่ง",
     "status": "sent",
     "sent_on": "2026-10-22",
     "auto_closed": false,
     "received_on": "2026-10-22",
     "worker_name": "x"
    },
    {
     "seq": 7,
     "code": "buff",
     "name": "ขัด",
     "status": "sent",
     "sent_on": "2026-10-22",
     "auto_closed": false,
     "received_on": "2026-10-22",
     "worker_name": "x"
    },
    {
     "seq": 8,
     "code": "gem_set",
     "name": "ฝังพลอย",
     "status": "received",
     "sent_on": null,
     "auto_closed": false,
     "received_on": "2026-10-22",
     "worker_name": "x"
    },
    {
     "seq": 9,
     "code": "qc",
     "name": "ตรวจ QC",
     "status": "pending",
     "sent_on": null,
     "auto_closed": false,
     "received_on": null,
     "worker_name": null
    },
    {
     "seq": 10,
     "code": "pack",
     "name": "แพ็ก",
     "status": "pending",
     "sent_on": null,
     "auto_closed": false,
     "received_on": null,
     "worker_name": null
    }
   ],
   "status": "in_progress",
   "due_date": null,
   "gems_state": "specified",
   "has_profile": true,
   "qty_planned": 10,
   "design_label": "แหวนไม่มีแม่แบบ A3",
   "profile_name": "แบบ 1 — ชั่งเฉพาะหล่อ"
  },
  "parts": [
   {
    "days": 0,
    "label": "JB-0003",
    "status": "in_progress",
    "is_mine": null,
    "lot_seq": 0,
    "qty_live": 10,
    "lot_job_id": "a568c1f8-83ae-49b8-be84-f3706c32b756",
    "stage_code": "gem_set",
    "stage_name": "ฝังพลอย",
    "holder_name": "x",
    "qty_planned": 10,
    "can_cancel_split": false
   }
  ],
  "viewer": {
   "worker_id": "59b61218-c93f-4963-9864-6ceb3cd5c5c2",
   "display_name": "ZZ-W ช่างฝัง"
  },
  "held_by": "x",
  "workers": [],
  "my_actions": [],
  "next_action": "receive",
  "action_stage": {
   "seq": 9,
   "code": "qc",
   "name": "ตรวจ QC",
   "scrap_qty_ask": false,
   "weight_required": false,
   "scrap_weight_ask": false
  },
  "scrap_reasons": [],
  "session_expired": false,
  "prev_weight_out_g": null
 },
 "rename_similar_err": {
  "_err": "พบชื่อที่คล้ายกับที่มีอยู่แล้ว — ตรวจก่อน หรือยืนยันเปลี่ยนชื่อ",
  "_hint": "gem_similar",
  "_state": "22023",
  "_detail": "{\"similar\": [{\"kind\": \"type\", \"name\": \"ZZUI โกเมนน\", \"rows\": [], \"matches\": [{\"id\": \"e9b8154d-269a-4fe6-b0da-955ed3653cc1\", \"name\": \"ZZUI โกเมน\"}, {\"id\": \"05361a35-2b14-4dea-bd11-2fe16a1f6f3c\", \"name\": \"ZZUI โกเมนต์\"}]}]}",
  "_detail_obj": {
   "similar": [
    {
     "kind": "type",
     "name": "ZZUI โกเมนน",
     "rows": [],
     "matches": [
      {
       "id": "e9b8154d-269a-4fe6-b0da-955ed3653cc1",
       "name": "ZZUI โกเมน"
      },
      {
       "id": "05361a35-2b14-4dea-bd11-2fe16a1f6f3c",
       "name": "ZZUI โกเมนต์"
      }
     ]
    }
   ]
  }
 },
 "merge_preview": {
  "from": {
   "id": "05361a35-2b14-4dea-bd11-2fe16a1f6f3c",
   "name": "ZZUI โกเมนต์"
  },
  "into": {
   "id": "e9b8154d-269a-4fe6-b0da-955ed3653cc1",
   "name": "ZZUI โกเมน"
  },
  "items_moved": 0,
  "items_collapsed": 2,
  "jobs_open_using": 0,
  "jobs_using_total": 0,
  "prices_not_moved": 0,
  "template_products": [
   "89a6ac94-a317-4998-891b-aed922812094"
  ],
  "snapshots_unchanged": true,
  "template_lines_summed": 0,
  "template_qty_overflow": 0,
  "template_lines_repointed": 1,
  "collapsed_missing_price_on_target": 0
 },
 "product_gem_bom_get": {
  "lines": [
   {
    "label": "ZZUI โกเมน · ไข่ · 4×6 มม.",
    "size_a": 4,
    "size_b": 6,
    "type_id": "e9b8154d-269a-4fe6-b0da-955ed3653cc1",
    "line_seq": 1,
    "position": "หัวแหวน",
    "shape_id": "d9816e9d-f823-4bd5-8f14-03f49411e1df",
    "is_active": true,
    "type_name": "ZZUI โกเมน",
    "has_length": true,
    "shape_name": "ไข่",
    "size_label": "4×6",
    "gem_item_id": "e94212fb-e041-4ed1-b1e4-f64562dbf5d7",
    "qty_per_piece": 2
   }
  ],
  "product_id": "89a6ac94-a317-4998-891b-aed922812094"
 },
 "plan_gem_bom": [
  {
   "label": "ZZUI โกเมน · ไข่ · 4×6 มม.",
   "size_a": 4,
   "size_b": 6,
   "source": "product",
   "type_id": "e9b8154d-269a-4fe6-b0da-955ed3653cc1",
   "position": "หัวแหวน",
   "shape_id": "d9816e9d-f823-4bd5-8f14-03f49411e1df",
   "is_active": true,
   "qty_total": 14,
   "type_name": "ZZUI โกเมน",
   "has_length": true,
   "shape_name": "ไข่",
   "size_label": "4×6",
   "gem_item_id": "e94212fb-e041-4ed1-b1e4-f64562dbf5d7",
   "qty_per_piece": 2
  }
 ],
 "catalog_item": {
  "via": "office",
  "label": "ZZUI โกเมน · กลม · 2 มม.",
  "price": null,
  "size_a": 2,
  "size_b": null,
  "type_id": "e9b8154d-269a-4fe6-b0da-955ed3653cc1",
  "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
  "has_price": false,
  "is_active": true,
  "type_name": "ZZUI โกเมน",
  "created_at": "2026-10-22T14:26:20.246863+00:00",
  "has_length": false,
  "price_rows": 0,
  "shape_name": "กลม",
  "size_label": "2",
  "gem_item_id": "fe456f78-2dd8-491a-80a3-fed84b78712f",
  "merged_into": null,
  "type_merged": false,
  "price_supplier": null,
  "used_jobs_open": 0,
  "used_templates": 0,
  "used_jobs_total": 0,
  "price_effective_from": null
 },
 "catalog_type": {
  "id": "e9b8154d-269a-4fe6-b0da-955ed3653cc1",
  "via": "office",
  "name": "ZZUI โกเมน",
  "is_active": true,
  "created_at": "2026-10-22T14:26:20.246863+00:00",
  "item_count": 3,
  "merged_into": null,
  "used_jobs_open": 2,
  "used_templates": 1,
  "merged_into_name": null
 },
 "catalog_shape": {
  "id": "7e5c1b02-e861-4165-bf3c-b79b9fec24bf",
  "via": "seed",
  "name": "6 เหลี่ยม",
  "is_seed": true,
  "is_active": true,
  "created_at": "2026-10-22T14:26:20.246863+00:00",
  "has_length": false,
  "item_count": 0,
  "merged_into": null,
  "used_jobs_open": 0,
  "used_templates": 0,
  "merged_into_name": null
 },
 "price_history": {
  "rows": [
   {
    "note": "พิมพ์ผิดตัวเลข",
    "price": 7000,
    "supplier": null,
    "updated_at": "2026-10-22T14:26:20.246863+00:00",
    "updated_by": "58e3c736-a85e-4cee-9b37-d4497ca3e1b1",
    "effective_from": "2026-10-22"
   }
  ],
  "audit": [
   {
    "note": null,
    "actor": "58e3c736-a85e-4cee-9b37-d4497ca3e1b1",
    "action": "insert",
    "new_price": 7391.2468,
    "old_price": null,
    "recorded_at": "2026-10-22T14:26:20.246863+00:00",
    "effective_from": "2026-10-22"
   },
   {
    "note": "พิมพ์ผิดตัวเลข",
    "actor": "58e3c736-a85e-4cee-9b37-d4497ca3e1b1",
    "action": "update",
    "new_price": 7000,
    "old_price": 7391.2468,
    "recorded_at": "2026-10-22T14:26:20.246863+00:00",
    "effective_from": "2026-10-22"
   }
  ],
  "gem_item_id": "e75a7e8c-e491-49e2-8b3b-66c79baaa4fe"
 },
 "options_list": {
  "items": [
   {
    "size_a": 1.25,
    "size_b": null,
    "type_id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "1.25",
    "gem_item_id": "c613eb23-aa67-4bce-8e79-a85236f1c2db"
   },
   {
    "size_a": 1.5,
    "size_b": null,
    "type_id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "1.5",
    "gem_item_id": "ea6c2c78-a4bf-4d23-ae2b-5a5b70c93d7c"
   },
   {
    "size_a": 1.75,
    "size_b": null,
    "type_id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "1.75",
    "gem_item_id": "e2bbf9cd-53b3-4897-93f6-5d746b3bfe56"
   },
   {
    "size_a": 2,
    "size_b": null,
    "type_id": "e9b8154d-269a-4fe6-b0da-955ed3653cc1",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "2",
    "gem_item_id": "fe456f78-2dd8-491a-80a3-fed84b78712f"
   },
   {
    "size_a": 2,
    "size_b": null,
    "type_id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "2",
    "gem_item_id": "2f288ad6-a92c-49ea-ac58-d8a83354cb0b"
   },
   {
    "size_a": 2.25,
    "size_b": null,
    "type_id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "2.25",
    "gem_item_id": "5a5d747f-05f6-45d8-ac47-7ed58974ca3f"
   },
   {
    "size_a": 2.5,
    "size_b": null,
    "type_id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "2.5",
    "gem_item_id": "7a7ecc64-0b87-4300-b56a-a531cbebfde6"
   },
   {
    "size_a": 2.75,
    "size_b": null,
    "type_id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "2.75",
    "gem_item_id": "f374fd3e-7a21-4316-b81e-c9100b83fc75"
   },
   {
    "size_a": 3,
    "size_b": null,
    "type_id": "e9b8154d-269a-4fe6-b0da-955ed3653cc1",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "3",
    "gem_item_id": "e75a7e8c-e491-49e2-8b3b-66c79baaa4fe"
   },
   {
    "size_a": 3,
    "size_b": null,
    "type_id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "3",
    "gem_item_id": "6d62c6c1-6abe-4dfa-a35b-69829431ae43"
   },
   {
    "size_a": 3,
    "size_b": 5,
    "type_id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "shape_id": "08fca74d-b8f2-427f-bd9d-a32a75fd3a2e",
    "size_label": "3×5",
    "gem_item_id": "205437fb-ae27-4abf-a193-03690afccc67"
   },
   {
    "size_a": 3.25,
    "size_b": null,
    "type_id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "3.25",
    "gem_item_id": "4aacf181-be2d-4176-814a-a62925aea12f"
   },
   {
    "size_a": 3.5,
    "size_b": null,
    "type_id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "3.5",
    "gem_item_id": "2da74d14-9e52-4303-b3cf-aa803bbec1f9"
   },
   {
    "size_a": 3.5,
    "size_b": null,
    "type_id": "2a904bca-8436-4717-ac49-750eaa4c14cf",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "3.5",
    "gem_item_id": "b55e8378-b71c-4228-9c60-c8bf6cfe235d"
   },
   {
    "size_a": 3.75,
    "size_b": null,
    "type_id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "3.75",
    "gem_item_id": "63c49ae0-24eb-4bb6-9245-7d414a5ef648"
   },
   {
    "size_a": 4,
    "size_b": null,
    "type_id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "4",
    "gem_item_id": "fd85f938-b8a4-4fa3-9d7d-d1991efa3c90"
   },
   {
    "size_a": 4,
    "size_b": 6,
    "type_id": "e9b8154d-269a-4fe6-b0da-955ed3653cc1",
    "shape_id": "d9816e9d-f823-4bd5-8f14-03f49411e1df",
    "size_label": "4×6",
    "gem_item_id": "e94212fb-e041-4ed1-b1e4-f64562dbf5d7"
   },
   {
    "size_a": 4.25,
    "size_b": null,
    "type_id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "4.25",
    "gem_item_id": "5892aead-fd7d-4aa6-aafb-6d6e8bfea618"
   },
   {
    "size_a": 4.5,
    "size_b": null,
    "type_id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "4.5",
    "gem_item_id": "cc2663f8-fcb8-414e-8e10-904e24378dcc"
   },
   {
    "size_a": 4.75,
    "size_b": null,
    "type_id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "4.75",
    "gem_item_id": "eff7c31f-d5c8-43ce-adfc-fe8dc8fdeaf3"
   },
   {
    "size_a": 5,
    "size_b": null,
    "type_id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "5",
    "gem_item_id": "7326140d-ed0b-49ea-a5a5-476cc5a8a803"
   },
   {
    "size_a": 5.25,
    "size_b": null,
    "type_id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "5.25",
    "gem_item_id": "80b67396-06ae-4691-907a-77dd9c985e1b"
   },
   {
    "size_a": 5.5,
    "size_b": null,
    "type_id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "5.5",
    "gem_item_id": "d6b782d3-1085-4626-ab15-df290b056b73"
   },
   {
    "size_a": 5.75,
    "size_b": null,
    "type_id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "5.75",
    "gem_item_id": "7787bf28-4235-4584-9bba-99ea2f08638d"
   },
   {
    "size_a": 6,
    "size_b": null,
    "type_id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "6",
    "gem_item_id": "f9eeed21-8a9d-4b0a-a8a9-4d7939322bc3"
   },
   {
    "size_a": 6.25,
    "size_b": null,
    "type_id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "6.25",
    "gem_item_id": "18ca7d67-0190-401d-9e89-a362fd477b23"
   },
   {
    "size_a": 6.5,
    "size_b": null,
    "type_id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "6.5",
    "gem_item_id": "f0884925-6d4e-41f4-9cc5-2910b43b0544"
   },
   {
    "size_a": 6.75,
    "size_b": null,
    "type_id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "6.75",
    "gem_item_id": "edeaefc7-5910-46a0-8d3e-61ec9be65b05"
   },
   {
    "size_a": 7,
    "size_b": null,
    "type_id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "7",
    "gem_item_id": "c06a31d3-4a24-4177-a7d9-de42d17aa45f"
   },
   {
    "size_a": 7.25,
    "size_b": null,
    "type_id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "7.25",
    "gem_item_id": "20995713-873b-4053-9d1b-5b692b0e2b0e"
   },
   {
    "size_a": 7.5,
    "size_b": null,
    "type_id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "7.5",
    "gem_item_id": "96a36590-d3f4-468b-9d17-1f39d996d882"
   },
   {
    "size_a": 7.75,
    "size_b": null,
    "type_id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "7.75",
    "gem_item_id": "7edfedd3-0d0a-4436-a1ed-1307c80fbf54"
   },
   {
    "size_a": 8,
    "size_b": null,
    "type_id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "8",
    "gem_item_id": "e4190756-cc3a-48b2-9af6-41edaa75aa4c"
   },
   {
    "size_a": 8.25,
    "size_b": null,
    "type_id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "8.25",
    "gem_item_id": "549f0125-002b-4aba-bd76-77b72a9efb3a"
   },
   {
    "size_a": 8.5,
    "size_b": null,
    "type_id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "8.5",
    "gem_item_id": "be8058ab-05e6-4821-b719-75f6cbb554b0"
   },
   {
    "size_a": 100,
    "size_b": null,
    "type_id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "shape_id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "size_label": "100",
    "gem_item_id": "6a9dde0f-0c91-40e7-a7d9-f6d183ec6129"
   }
  ],
  "types": [
   {
    "id": "e9b8154d-269a-4fe6-b0da-955ed3653cc1",
    "name": "ZZUI โกเมน"
   },
   {
    "id": "e1a57131-8f02-44e6-be1b-4087d6a009e7",
    "name": "ZZUI โกเมนน"
   },
   {
    "id": "2a904bca-8436-4717-ac49-750eaa4c14cf",
    "name": "ZZUI ซีแซด"
   }
  ],
  "shapes": [
   {
    "id": "7e5c1b02-e861-4165-bf3c-b79b9fec24bf",
    "name": "6 เหลี่ยม",
    "has_length": false
   },
   {
    "id": "08fca74d-b8f2-427f-bd9d-a32a75fd3a2e",
    "name": "ZZUI ทรงใบไม้",
    "has_length": true
   },
   {
    "id": "995e2e43-db25-49cc-9084-9f729903d4cd",
    "name": "กลม",
    "has_length": false
   },
   {
    "id": "d9816e9d-f823-4bd5-8f14-03f49411e1df",
    "name": "ไข่",
    "has_length": true
   },
   {
    "id": "6a4f9481-bcd0-4dd3-ba61-1d94de904397",
    "name": "คุชชั่น",
    "has_length": true
   },
   {
    "id": "fdcc1423-f0a1-4965-8d25-8bdae1002601",
    "name": "บาแก็ตต์",
    "has_length": true
   },
   {
    "id": "4df5fca8-543c-4223-a90c-f8f5ac74202a",
    "name": "มาร์คีส์",
    "has_length": true
   },
   {
    "id": "943daee2-1279-455b-a06f-20ae061cea00",
    "name": "สามเหลี่ยม",
    "has_length": false
   },
   {
    "id": "9c46d764-43d4-463d-8d1e-f5aa914ef879",
    "name": "สี่เหลี่ยมจัตุรัส",
    "has_length": false
   },
   {
    "id": "52ca5be8-bfdc-4785-ada3-fb4af8734248",
    "name": "สี่เหลี่ยมผืนผ้า",
    "has_length": true
   },
   {
    "id": "8035731a-11d4-40f4-982f-5929db6b9dd3",
    "name": "หยดน้ำ",
    "has_length": true
   },
   {
    "id": "34c1aa0f-addc-4ef4-92e1-8513f39e91d9",
    "name": "หัวใจ",
    "has_length": false
   },
   {
    "id": "0b272060-6065-44ba-b0ef-c64fb230c934",
    "name": "เอมเมอรัลด์",
    "has_length": true
   }
  ]
 }
};
