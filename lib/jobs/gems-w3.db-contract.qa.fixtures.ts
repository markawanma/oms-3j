// QA (R2-D2 · 23 ต.ค. 69) — W3 (0191): payload จริงของ RPC หน้างานพลอย — คัดจากการยิง RPC จริงบน DB (ร้านสังเคราะห์ ZZ TEST ในทรานแซกชันที่ ROLLBACK · dry-run 0191 · scripts/verify ไม่ commit)
// ใช้พิสูจน์ว่าชั้น TS (worker-server) อ่านของจริงได้ ไม่ใช่แค่ mock ที่ทีมเขียนเอง · token ถูกแทนด้วยค่ารูปจริงคงที่ (ของเดิมสุ่มในทรานแซกชันที่ถอยแล้ว)
export const W3_REAL: Record<string, unknown> = {
  "catalog_template": {
    "ok": true,
    "sizes": [
      {
        "size_a": 1.5,
        "size_b": null,
        "type_id": "5ac8ac37-868c-4672-b7ef-ebf087933aaa",
        "shape_id": "3e2cc235-3143-4ce4-bd94-c10b60d21f64"
      },
      {
        "size_a": 4,
        "size_b": 6,
        "type_id": "b9160b95-9903-4f01-b3b4-b38919ce23ec",
        "shape_id": "d6a3014a-80d6-49a6-9607-a3ca724c2c24"
      }
    ],
    "types": [
      {
        "id": "8ee103bc-8cf2-4016-9fa3-74a47de291b1",
        "name": "Amethyst"
      },
      {
        "id": "5ac8ac37-868c-4672-b7ef-ebf087933aaa",
        "name": "CZ"
      },
      {
        "id": "51302c86-ad3c-454a-8b3c-b8dfec4cf84e",
        "name": "Garnet"
      },
      {
        "id": "c7fa71f2-b121-4bf2-869d-9cacc1adf928",
        "name": "Opal"
      },
      {
        "id": "7dee1c84-4dff-4c74-9413-fea47a92047d",
        "name": "Quartz"
      },
      {
        "id": "9a04bc0c-2083-4ff9-9196-ee27c97a7cae",
        "name": "Zircon"
      },
      {
        "id": "b9160b95-9903-4f01-b3b4-b38919ce23ec",
        "name": "โกเมน"
      }
    ],
    "shapes": [
      {
        "id": "ec2cd6dd-75b7-430f-a3ac-14b1416cc9d8",
        "name": "6 เหลี่ยม",
        "has_length": false
      },
      {
        "id": "a0c45e18-905c-45e6-a392-959ee2db03af",
        "name": "Briolette",
        "has_length": true
      },
      {
        "id": "3e2cc235-3143-4ce4-bd94-c10b60d21f64",
        "name": "กลม",
        "has_length": false
      },
      {
        "id": "d6a3014a-80d6-49a6-9607-a3ca724c2c24",
        "name": "ไข่",
        "has_length": true
      },
      {
        "id": "ca9b8c46-bd23-4e21-a668-f7903197a7e2",
        "name": "คุชชั่น",
        "has_length": true
      },
      {
        "id": "44418595-3b09-40b4-b471-85eb09dc5aa3",
        "name": "บาแก็ตต์",
        "has_length": true
      },
      {
        "id": "79343e97-cbfe-4d3f-a0c6-fe5480580260",
        "name": "มาร์คีส์",
        "has_length": true
      },
      {
        "id": "82bce16b-fbb3-412f-8ec4-9654a031eea6",
        "name": "สามเหลี่ยม",
        "has_length": false
      },
      {
        "id": "a9374326-1c63-41cf-b532-19d3a13130c1",
        "name": "สี่เหลี่ยมจัตุรัส",
        "has_length": false
      },
      {
        "id": "984df3a3-dd54-4dc7-97bb-ac7b09bb0b7e",
        "name": "สี่เหลี่ยมผืนผ้า",
        "has_length": true
      },
      {
        "id": "c4a6d72e-ee26-4585-bc7c-dc110dcb9032",
        "name": "หยดน้ำ",
        "has_length": true
      },
      {
        "id": "a9e80be0-60dd-43c5-b345-304194671671",
        "name": "หัวใจ",
        "has_length": false
      },
      {
        "id": "b32f260b-7140-49e6-af85-f062ec15f674",
        "name": "เอมเมอรัลด์",
        "has_length": true
      }
    ],
    "template": [
      {
        "label": "โกเมน · ไข่ · 4×6 มม.",
        "size_a": 4,
        "size_b": 6,
        "type_id": "b9160b95-9903-4f01-b3b4-b38919ce23ec",
        "position": "ล้อมรอบ",
        "shape_id": "d6a3014a-80d6-49a6-9607-a3ca724c2c24",
        "type_name": "โกเมน",
        "has_length": true,
        "shape_name": "ไข่",
        "gem_item_id": "63a71215-a428-42d2-b529-843cb429fd3e",
        "qty_per_piece": 2
      },
      {
        "label": "CZ · กลม · 1.5 มม.",
        "size_a": 1.5,
        "size_b": null,
        "type_id": "5ac8ac37-868c-4672-b7ef-ebf087933aaa",
        "position": null,
        "shape_id": "3e2cc235-3143-4ce4-bd94-c10b60d21f64",
        "type_name": "CZ",
        "has_length": false,
        "shape_name": "กลม",
        "gem_item_id": "77c66dfb-af78-4d3b-89b7-d4c45c6d676c",
        "qty_per_piece": 30
      }
    ],
    "max_lines": 30,
    "has_template": true
  },
  "catalog_notemplate": {
    "ok": true,
    "sizes": [
      {
        "size_a": 1.5,
        "size_b": null,
        "type_id": "5ac8ac37-868c-4672-b7ef-ebf087933aaa",
        "shape_id": "3e2cc235-3143-4ce4-bd94-c10b60d21f64"
      },
      {
        "size_a": 4,
        "size_b": 6,
        "type_id": "b9160b95-9903-4f01-b3b4-b38919ce23ec",
        "shape_id": "d6a3014a-80d6-49a6-9607-a3ca724c2c24"
      }
    ],
    "types": [
      {
        "id": "8ee103bc-8cf2-4016-9fa3-74a47de291b1",
        "name": "Amethyst"
      },
      {
        "id": "5ac8ac37-868c-4672-b7ef-ebf087933aaa",
        "name": "CZ"
      },
      {
        "id": "51302c86-ad3c-454a-8b3c-b8dfec4cf84e",
        "name": "Garnet"
      },
      {
        "id": "c7fa71f2-b121-4bf2-869d-9cacc1adf928",
        "name": "Opal"
      },
      {
        "id": "7dee1c84-4dff-4c74-9413-fea47a92047d",
        "name": "Quartz"
      },
      {
        "id": "9a04bc0c-2083-4ff9-9196-ee27c97a7cae",
        "name": "Zircon"
      },
      {
        "id": "b9160b95-9903-4f01-b3b4-b38919ce23ec",
        "name": "โกเมน"
      }
    ],
    "shapes": [
      {
        "id": "ec2cd6dd-75b7-430f-a3ac-14b1416cc9d8",
        "name": "6 เหลี่ยม",
        "has_length": false
      },
      {
        "id": "a0c45e18-905c-45e6-a392-959ee2db03af",
        "name": "Briolette",
        "has_length": true
      },
      {
        "id": "3e2cc235-3143-4ce4-bd94-c10b60d21f64",
        "name": "กลม",
        "has_length": false
      },
      {
        "id": "d6a3014a-80d6-49a6-9607-a3ca724c2c24",
        "name": "ไข่",
        "has_length": true
      },
      {
        "id": "ca9b8c46-bd23-4e21-a668-f7903197a7e2",
        "name": "คุชชั่น",
        "has_length": true
      },
      {
        "id": "44418595-3b09-40b4-b471-85eb09dc5aa3",
        "name": "บาแก็ตต์",
        "has_length": true
      },
      {
        "id": "79343e97-cbfe-4d3f-a0c6-fe5480580260",
        "name": "มาร์คีส์",
        "has_length": true
      },
      {
        "id": "82bce16b-fbb3-412f-8ec4-9654a031eea6",
        "name": "สามเหลี่ยม",
        "has_length": false
      },
      {
        "id": "a9374326-1c63-41cf-b532-19d3a13130c1",
        "name": "สี่เหลี่ยมจัตุรัส",
        "has_length": false
      },
      {
        "id": "984df3a3-dd54-4dc7-97bb-ac7b09bb0b7e",
        "name": "สี่เหลี่ยมผืนผ้า",
        "has_length": true
      },
      {
        "id": "c4a6d72e-ee26-4585-bc7c-dc110dcb9032",
        "name": "หยดน้ำ",
        "has_length": true
      },
      {
        "id": "a9e80be0-60dd-43c5-b345-304194671671",
        "name": "หัวใจ",
        "has_length": false
      },
      {
        "id": "b32f260b-7140-49e6-af85-f062ec15f674",
        "name": "เอมเมอรัลด์",
        "has_length": true
      }
    ],
    "template": [],
    "max_lines": 30,
    "has_template": false
  },
  "open_has": {
    "ok": true,
    "gem": {
      "count": 2,
      "state": "specified",
      "total": 148,
      "reused": [],
      "merged_rows": [
        [
          2,
          3
        ]
      ],
      "created_types": [
        "บุษราคัมเอฟเอ็กซ์"
      ],
      "created_shapes": [
        "ทรงใบมะกอกเอฟเอ็กซ์"
      ]
    },
    "sku": null,
    "metal": "silver",
    "token": "cIU9WS-DUZGrTC9v3LaEWrV7-BeHiX46Y4ZtBJa5YBU",
    "job_no": "JB-0002",
    "status": "open",
    "already": false,
    "due_date": null,
    "order_no": "PO-0002",
    "qty_order": 3,
    "qty_planned": 4,
    "sku_pending": true,
    "design_label": "แหวน FX",
    "is_new_design": false
  },
  "open_replay": {
    "ok": true,
    "gem": {
      "count": 2,
      "state": "specified",
      "total": 148
    },
    "sku": null,
    "metal": "silver",
    "job_no": "JB-0002",
    "status": "open",
    "already": true,
    "due_date": null,
    "order_no": "PO-0002",
    "qty_order": 3,
    "qty_planned": 4,
    "sku_pending": true,
    "design_label": "แหวน FX",
    "is_new_design": false
  },
  "get_open": {
    "ok": true,
    "job": {
      "job_id": "1ae13bd2-1742-4df4-b4ca-d0dc9e7235af",
      "job_no": "JB-0002",
      "status": "open",
      "qty_planned": 4,
      "design_label": "แหวน FX"
    },
    "rev": "8774eecd1de3638692d4386705431be2",
    "lines": [
      {
        "label": "บุษราคัมเอฟเอ็กซ์ · ทรงใบมะกอกเอฟเอ็กซ์ · 3×6 มม.",
        "size_a": 3,
        "size_b": 6,
        "type_id": "132238d0-43ad-4bf6-ab93-1ebd98c69d1e",
        "position": "ล้อมรอบ",
        "shape_id": "7cee92b3-fc84-45ba-9916-7d608b3bb44e",
        "qty_total": 8,
        "type_name": "บุษราคัมเอฟเอ็กซ์",
        "has_length": true,
        "shape_name": "ทรงใบมะกอกเอฟเอ็กซ์",
        "gem_item_id": "df71be15-98de-44d1-8076-e728faea1293",
        "qty_per_piece": 2
      },
      {
        "label": "CZ · กลม · 1.5 มม.",
        "size_a": 1.5,
        "size_b": null,
        "type_id": "5ac8ac37-868c-4672-b7ef-ebf087933aaa",
        "position": null,
        "shape_id": "3e2cc235-3143-4ce4-bd94-c10b60d21f64",
        "qty_total": 140,
        "type_name": "CZ",
        "has_length": false,
        "shape_name": "กลม",
        "gem_item_id": "77c66dfb-af78-4d3b-89b7-d4c45c6d676c",
        "qty_per_piece": 35
      }
    ],
    "state": "specified",
    "editable": true,
    "lock_code": null,
    "max_lines": 30,
    "has_gem_stage": true
  },
  "set_similar": {
    "ok": false,
    "code": "gem_similar",
    "message": "พบชื่อพลอยที่คล้ายกับที่มีอยู่แล้ว — ใช้ตัวที่มี หรือยืนยันเพิ่มเป็นชื่อใหม่",
    "similar": [
      {
        "kind": "type",
        "name": "Garnett",
        "rows": [
          3
        ],
        "matches": [
          {
            "id": "51302c86-ad3c-454a-8b3c-b8dfec4cf84e",
            "name": "Garnet"
          }
        ]
      }
    ]
  },
  "set_ok": {
    "ok": true,
    "rev": "6e16b30f72748b149b83ae1c1740ba01",
    "count": 3,
    "lines": [
      {
        "label": "บุษราคัมเอฟเอ็กซ์ · ทรงใบมะกอกเอฟเอ็กซ์ · 3×6 มม.",
        "position": "ล้อมรอบ",
        "qty_total": 12,
        "gem_item_id": "df71be15-98de-44d1-8076-e728faea1293",
        "qty_per_piece": 3
      },
      {
        "label": "ทับทิมเอฟเอ็กซ์ · กลม · 2 มม.",
        "position": null,
        "qty_total": 40,
        "gem_item_id": "c1181bc3-954e-407e-a916-0e7851cedbed",
        "qty_per_piece": 10
      },
      {
        "label": "CZ · กลม · 2 มม.",
        "position": null,
        "qty_total": 4,
        "gem_item_id": "9f7b5a0a-cfab-49bd-8a78-dc08d95224ad",
        "qty_per_piece": 1
      }
    ],
    "state": "specified",
    "changed": true,
    "summary": {
      "reused": [
        {
          "row": 3,
          "kind": "type",
          "name": "CZ",
          "typed": "cz"
        }
      ],
      "merged_rows": [],
      "created_types": [
        "ทับทิมเอฟเอ็กซ์"
      ],
      "created_shapes": []
    }
  },
  "set_bad_row": {
    "ok": false,
    "code": "gem_line_invalid",
    "gem_row": 2,
    "message": "ข้อมูลพลอยไม่ถูกต้อง — ตรวจแถวที่ระบุแล้วลองอีกครั้ง",
    "gem_code": "size_invalid",
    "gem_field": "size_a"
  },
  "set_conflict": {
    "ok": false,
    "code": "gem_conflict",
    "message": "มีการแก้พลอยของใบนี้ไปแล้ว (อาจจากอีกเครื่อง) — โหลดหน้าใหม่แล้วแก้อีกครั้ง"
  },
  "my_list": {
    "ok": true,
    "jobs": [
      {
        "qty": 3,
        "metal": "silver",
        "job_id": "1ae13bd2-1742-4df4-b4ca-d0dc9e7235af",
        "job_no": "JB-0002",
        "status": "open",
        "editable": true,
        "order_no": "PO-0002",
        "gem_count": 3,
        "gem_state": "specified",
        "created_at": "2026-10-23T15:12:46.650889+00:00",
        "gem_pieces": 56,
        "design_label": "แหวน FX",
        "gem_editable": true,
        "photos_count": 0,
        "my_photos_count": 0
      }
    ],
    "max_photos": 3,
    "open_allowed": true
  },
  "open_template": {
    "ok": true,
    "gem": {
      "count": 2,
      "state": "specified",
      "total": 64,
      "reused": [],
      "merged_rows": [],
      "created_types": [],
      "created_shapes": []
    },
    "sku": "ZZ191-T",
    "metal": "silver",
    "token": "cIU9WS-DUZGrTC9v3LaEWrV7-BeHiX46Y4ZtBJa5YBU",
    "job_no": "JB-0003",
    "status": "open",
    "already": false,
    "due_date": null,
    "order_no": "PO-0003",
    "qty_order": 2,
    "qty_planned": 2,
    "sku_pending": false,
    "design_label": "แหวนมีแม่แบบพลอย",
    "is_new_design": false
  },
  "open_none": {
    "ok": true,
    "gem": {
      "count": 0,
      "state": "not_needed",
      "total": 0,
      "reused": [],
      "merged_rows": [],
      "created_types": [],
      "created_shapes": []
    },
    "sku": null,
    "metal": "silver",
    "token": "cIU9WS-DUZGrTC9v3LaEWrV7-BeHiX46Y4ZtBJa5YBU",
    "job_no": "JB-0004",
    "status": "open",
    "already": false,
    "due_date": null,
    "order_no": "PO-0004",
    "qty_order": 2,
    "qty_planned": 2,
    "sku_pending": true,
    "design_label": "แหวน FX2",
    "is_new_design": false
  },
  "open_similar": {
    "ok": false,
    "code": "gem_similar",
    "message": "พบชื่อพลอยที่คล้ายกับที่มีอยู่แล้ว — ใช้ตัวที่มี หรือยืนยันเพิ่มเป็นชื่อใหม่",
    "similar": [
      {
        "kind": "type",
        "name": "Garnett",
        "rows": [
          1
        ],
        "matches": [
          {
            "id": "51302c86-ad3c-454a-8b3c-b8dfec4cf84e",
            "name": "Garnet"
          }
        ]
      }
    ]
  },
  "open_bad_row": {
    "ok": false,
    "code": "gem_line_invalid",
    "gem_row": 2,
    "message": "ข้อมูลพลอยไม่ถูกต้อง — ตรวจแถวที่ระบุแล้วลองอีกครั้ง",
    "gem_code": "qty_invalid",
    "gem_field": "qty_per_piece"
  },
  "open_template_required": {
    "ok": false,
    "code": "gem_answer_required",
    "message": "สินค้านี้ยังไม่มีแม่แบบพลอย — เลือกก่อนว่าฝังพลอยหรือไม่ฝังพลอย"
  },
  "open_noanswer_nostage": {
    "ok": true,
    "gem": {
      "count": 0,
      "state": "not_needed",
      "total": 0,
      "reused": [],
      "merged_rows": [],
      "created_types": [],
      "created_shapes": []
    },
    "sku": null,
    "metal": "silver",
    "token": "cIU9WS-DUZGrTC9v3LaEWrV7-BeHiX46Y4ZtBJa5YBU",
    "job_no": "JB-0005",
    "status": "open",
    "already": false,
    "due_date": null,
    "order_no": "PO-0005",
    "qty_order": 2,
    "qty_planned": 2,
    "sku_pending": true,
    "design_label": "แหวน FX5",
    "is_new_design": false
  },
  "no_session": {
    "ok": false,
    "code": "session_required",
    "message": "หมดเวลาแล้ว — ใส่ PIN ใหม่"
  }
};
