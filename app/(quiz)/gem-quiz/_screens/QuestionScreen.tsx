// QuestionScreen (Q1/Q2/Q3/Q5) — คำถามแนะนำ 1 ข้อต่อจอ (design §5). ใช้ซ้ำกับ
// ทั้ง birth_day/intention/feeling/jewelry_type — เลย์เอาต์ (list เต็มแถว vs
// grid 2 คอลัมน์) ตรงตาม mockup ของแต่ละคำถามจริง (Quiz.dc.html S01-S03/S05):
// birth_day = list ล้วน, intention/feeling = grid ล้วน, jewelry_type = grid 4
// ตัวเลือกหลัก + "ยังไม่แน่ใจ" เป็นแถว list แยกด้านล่าง.
import { OptionCard } from "../_components/OptionCard";
import { PrimaryButton } from "../_components/PrimaryButton";
import { QuestionOptionIcon } from "../_components/QuestionOptionIcon";
import { QuizHeader } from "../_components/QuizHeader";

// คำบรรยายสั้นใต้หัวคำถาม — ข้อความ UI/นำทางล้วน (ไม่ใช่เนื้อหาเชิงความเชื่อ/
// แบรนด์ที่ต้องผ่าน 3 ด่าน) คัดลอกคำต่อคำจาก mockup ที่อนุมัติแล้ว
// (Quiz.dc.html S01/S02/S03/S05).
const SUBTITLE_BY_QUESTION: Record<string, string> = {
  birth_day: "เลือกวันเกิดของคุณ",
  intention: "เลือก 1 สิ่งที่คุณอยากโฟกัสที่สุดในวันนี้",
  feeling: "เลือกสิ่งที่ใกล้เคียงกับคุณที่สุด",
  jewelry_type: "เลือกประเภทเครื่องประดับที่คุณชอบ",
};

interface QuestionOption {
  code: string;
  labelTh: string;
}

export function QuestionScreen({
  questionCode,
  labelTh,
  options,
  selected,
  onSelect,
  onNext,
  onBack,
  current,
  total,
}: {
  questionCode: string;
  labelTh: string;
  options: readonly QuestionOption[];
  selected: string | undefined;
  onSelect: (code: string) => void;
  onNext: () => void;
  onBack: () => void;
  current: number;
  total: number;
}) {
  const isJewelryType = questionCode === "jewelry_type";
  const isListOnly = questionCode === "birth_day";

  // jewelry_type: 4 ตัวเลือกหลัก (grid) + "unknown" (list) ตามลำดับจริงใน
  // GEM_QUIZ_QUESTIONS (ring/necklace/earring/bracelet/unknown) — ไม่ hardcode
  // index เพื่อกันพังถ้าลำดับ config เปลี่ยน แต่กรอง "unknown" ออกจาก grid.
  const gridOptions = isJewelryType ? options.filter((o) => o.code !== "unknown") : options;
  const listExtraOption = isJewelryType ? options.find((o) => o.code === "unknown") : undefined;

  return (
    <div className="motion-safe:animate-gq-fade-up flex min-h-screen flex-col sm:min-h-0">
      <QuizHeader current={current} total={total} onBack={onBack} />

      <div className="flex-1 px-5 py-6">
        <div className="flex flex-col gap-1.5 text-center">
          <h1 className="font-quiz-serif text-[25px] font-semibold leading-[1.35] text-[var(--gq-burgundy-dark)]">{labelTh}</h1>
          <p className="text-sm text-[var(--gq-text-muted)]">{SUBTITLE_BY_QUESTION[questionCode]}</p>
        </div>

        <div className={`mt-5 ${isListOnly ? "flex flex-col gap-2.5" : "grid grid-cols-2 gap-2.5"}`}>
          {(isListOnly ? options : gridOptions).map((option) => (
            <OptionCard
              key={option.code}
              variant={isListOnly ? "list" : "grid"}
              selected={selected === option.code}
              onClick={() => onSelect(option.code)}
              icon={<QuestionOptionIcon questionCode={questionCode} optionCode={option.code} size={isListOnly ? 22 : 28} />}
              label={option.labelTh}
            />
          ))}
        </div>

        {listExtraOption && (
          <div className="mt-2.5">
            <OptionCard
              variant="list"
              selected={selected === listExtraOption.code}
              onClick={() => onSelect(listExtraOption.code)}
              icon={<QuestionOptionIcon questionCode={questionCode} optionCode={listExtraOption.code} size={20} />}
              label={listExtraOption.labelTh}
            />
          </div>
        )}
      </div>

      <div className="border-t border-[var(--gq-border-soft)] px-5 py-5">
        <PrimaryButton onClick={onNext} disabled={!selected} trailingArrow>
          ถัดไป
        </PrimaryButton>
      </div>
    </div>
  );
}
