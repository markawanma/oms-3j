/**
 * Page code — หน้า silver-bar-test (merged จากโค้ดจริงของเจ้าของ)
 *
 * แก้จากของเดิมแค่ 3 จุด (element ID + logic เดิมคงไว้ครบ):
 *   1. import -> backend/silverPriceV2 (ตัวใหม่ที่มี snapshot fallback)
 *   2. เพิ่ม guard price.empty -> "กำลังอัปเดตราคา ติดต่อ LINE" (ไม่โชว์ 0 บาท)
 *   3. badge #lastUpdate -> แยกกรณี stale (snapshot) vs สด
 *
 * element ID = ของจริงจากหน้าเจ้าของ (#sellPriceA/#buyPriceA/#currentTime ฯลฯ) ไม่ใช่ที่ Han เดา
 */

import { getSheetPrice } from 'backend/silverPriceV2';

$w.onReady(function () {
    updateTime();
    setInterval(updateTime, 1000);

    if ($w("#fetchPrice")) {
        $w("#fetchPrice").onClick();
    }

    loadPrice();
});

function updateTime() {
    const now = new Date();
    const options = {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    };
    $w("#currentTime").text = now.toLocaleString('th-TH', options);
}

function formatPrice(value) {
    return Number(value || 0).toLocaleString('th-TH') + " บาท";
}

function formatDateTime(d) {
    if (!d) return "-";
    return new Date(d).toLocaleString('th-TH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

async function loadPrice() {
    try {
        const price = await getSheetPrice();

        // ไม่เคยมี snapshot เลย (ราคายังไม่เคยเข้าครั้งแรก) -> ไม่โชว์ 0 บาท
        if (price.empty) {
            $w("#lastUpdate").text = "กำลังอัปเดตราคา ติดต่อ LINE";
            return;
        }

        // ===== 1 KG =====
        $w("#buyPriceA").text = formatPrice(price.buy1kg);
        $w("#sellVatPriceA").text = formatPrice(price.sellVat1kg);
        $w("#sellPriceA").text = formatPrice(price.sell1kg);

        $w("#buyPrice1").text = formatPrice(price.buy1kg);
        $w("#sellVatPrice1").text = formatPrice(price.sellVat1kg);
        $w("#sellPrice1").text = formatPrice(price.sell1kg);

        // ===== ราคาซื้อ ต่อ 1 บาท =====
        $w("#buyPerBaht").text = formatPrice(price.buyPerBaht);

        // ===== ราคาขาย =====
        $w("#sellHalf").text = formatPrice(price.sellHalfBaht);
        $w("#sellOne").text = formatPrice(price.sellOneBaht);
        $w("#sellThree").text = formatPrice(price.sellThreeBaht);
        $w("#sellFive").text = formatPrice(price.sellFiveBaht);
        $w("#sellTen").text = formatPrice(price.sellTenBaht);

        // ===== ราคาซื้อ =====
        $w("#buyHalf").text = formatPrice(price.buyHalfBaht);
        $w("#buyOne").text = formatPrice(price.buyOneBaht);
        $w("#buyThree").text = formatPrice(price.buyThreeBaht);
        $w("#buyFive").text = formatPrice(price.buyFiveBaht);
        $w("#buyTen").text = formatPrice(price.buyTenBaht);

        // ===== ชุดที่ 2 =====
        $w("#sellHalf1").text = formatPrice(price.sellHalfBaht);
        $w("#sellOne1").text = formatPrice(price.sellOneBaht);
        $w("#sellThree1").text = formatPrice(price.sellThreeBaht);
        $w("#sellFive1").text = formatPrice(price.sellFiveBaht);
        $w("#sellTen1").text = formatPrice(price.sellTenBaht);

        $w("#buyHalf1").text = formatPrice(price.buyHalfBaht);
        $w("#buyOne1").text = formatPrice(price.buyOneBaht);
        $w("#buyThree1").text = formatPrice(price.buyThreeBaht);
        $w("#buyFive1").text = formatPrice(price.buyFiveBaht);
        $w("#buyTen1").text = formatPrice(price.buyTenBaht);

        // ===== badge เวลาอัปเดต =====
        if (price.stale) {
            $w("#lastUpdate").text =
                "ราคาล่าสุด ณ " + formatDateTime(price.fetchedAt) + " (อัปเดตอีกครั้งในเวลาทำการ)";
        } else {
            $w("#lastUpdate").text =
                "อัปเดตราคาล่าสุด : " + formatDateTime(price.fetchedAt);
        }

    } catch (err) {
        console.log("Fetch Error", err);
        $w("#lastUpdate").text = "ไม่สามารถดึงข้อมูลราคาได้";
    }
}
