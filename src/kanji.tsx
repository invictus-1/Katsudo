// 活動 (katsudō, "activity") and the kanji shown above each page title. The fonts only carry
// these characters: add one here, add it to KANJI in scripts/kanji-fonts.py and rerun it.

export const NAME = '活動';

export const PAGE_KANJI: Record<string, string> = {
  today: '今日',
  timeline: '時間軸',
  apps: 'アプリ',
  input: '入力',
  rhythm: '律動',
  network: '通信',
  wrapped: '年間',
  compare: '比較',
  tags: 'タグ',
  flow: '集中',
  import: '取込',
  backups: '保存',
  roadmap: '道標',
  settings: '設定',
};

/** The 活動 seal, a hanko stamped in each era's own way. */
export function Hanko({ className }: { className?: string }) {
  return (
    <span className={className ? `hanko ${className}` : 'hanko'} aria-hidden="true">
      <span>活</span>
      <span>動</span>
    </span>
  );
}
