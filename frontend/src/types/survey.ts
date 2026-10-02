/**
 * 成活率验收（Survey）
 * 按测次登记成活株数与平均株高，成活率由成活株数 / 栽植总株数派生。
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
  /** 成活株数（验收员当天实测的成活株数，补植增补不计入这里） */
  aliveCount: number;
  /** 平均株高（厘米） */
  avgHeightCm: number;
  /**
   * 验收当天固定的栽植总数（成活率分母）。
   * 仅统计 plantDate <= 验收日期的栽植记录，验收之后新增的栽植只影响后面的测次，
   * 已经定版的测次分母不动。
   */
  denominator: number;
  /** 分母是否为估算值：查不到验收当天的栽植记录时，按现有栽植总数估算并置 true */
  denominatorEstimated: boolean;
  /**
   * 增补株数（补植完成回写时单独标出，不混入 aliveCount）。
   * 补植完成只更新最新测次的增补数，早先测次不动。
   */
  supplementCount: number;
  /** 成活率（百分比，保留 1 位小数）=（成活株数 + 增补株数）/ 固定分母 × 100 */
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
