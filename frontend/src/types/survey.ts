/**
 * 成活率验收（Survey）
 * 按测次登记成活株数与平均株高；
 * 成活率 =（成活株数 + 补植增补）/ 验收当天锁定的栽植总株数，分母在测次保存时快照、之后不再浮动。
 */

/** 成活率等级：优 / 良 / 一般 / 差 */
export type RateLevel = 'excellent' | 'good' | 'fair' | 'poor';

export const RATE_LEVEL_LABEL: Record<RateLevel, string> = {
  excellent: '优',
  good: '良',
  fair: '一般',
  poor: '差',
};

export const RATE_LEVEL_OPTIONS: RateLevel[] = ['excellent', 'good', 'fair', 'poor'];

export interface Survey {
  id: string;
  /** 所属地块 */
  plotId: string;
  /** 测次（1、2、3……） */
  round: number;
  /** 验收日期 YYYY-MM-DD */
  date: string;
  /** 成活株数（验收实测值，补植增补不并入此列） */
  aliveCount: number;
  /** 平均株高（厘米） */
  avgHeightCm: number;
  /** 验收当天锁定的栽植总株数（分母快照）：测次保存时固定，之后新增栽植只影响后续测次 */
  plantedTotal: number;
  /** 补植完成后增补到本测次的成活株数（单独标出，不改写实测值；仅最新测次会被回写） */
  replantBoost: number;
  /** 成活率（百分比，保留 1 位小数）——（成活株数 + 补植增补）/ 锁定分母 */
  survivalRate: number;
  /** 成活率等级——默认按区间自动判定，可人工批量调整 */
  grade: RateLevel;
  /** 该等级是否被人工调整过 */
  gradeManual: boolean;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

/** 新建 / 编辑验收记录的表单草稿 */
export interface SurveyDraft {
  plotId: string;
  round: number;
  date: string;
  aliveCount: number;
  avgHeightCm: number;
}
