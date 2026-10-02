/**
 * 验收状态管理（Zustand）
 * 维护验收筛选条件、批量选中的记录与成活率等级草稿；
 * 成活率派生值统一由 hooks/useSurvivalRate 的纯函数产出，避免口径分散。
 */
import { create } from 'zustand';
import type { RateLevel, Survey } from '../types/survey';
import { ROW_REVISION, db, initDatabase, patchSurveyGrades, putSurvey, removeSurvey } from '../utils/db';
import type { SurvivalSummary } from '../hooks/useSurvivalRate';
import { nowIso, uuid } from '../utils/id';
import { calcSurvivalRate, plantedTotalOn, rateLevel } from '../utils/rate';
import type { SurveyDraft } from '../types/survey';
import { usePlotStore } from './plotStore';

/** 验收筛选条件（地块 + 等级 + 关键字 + 日期区间） */
export interface SurveyFilters {
  plotId: string | 'all';
  level: RateLevel | 'all';
  keyword: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: SurveyFilters = { plotId: 'all', level: 'all', keyword: '', from: '', to: '' };

interface SurveyStoreState {
  filters: SurveyFilters;
  /** 批量操作选中的验收记录 id */
  selectedIds: string[];
  /** 批量调整使用的目标等级 */
  gradeDraft: RateLevel;
  /** 每次写操作后的版本号，页面据此重新拉取列表 */
  revision: number;
  lastMessage: string;
  init: () => Promise<void>;
  setFilters: (patch: Partial<SurveyFilters>) => void;
  resetFilters: () => void;
  setSelectedIds: (ids: string[]) => void;
  setGradeDraft: (level: RateLevel) => void;
  createSurvey: (draft: SurveyDraft) => Promise<Survey>;
  updateSurvey: (surveyId: string, draft: SurveyDraft) => Promise<void>;
  deleteSurvey: (surveyId: string) => Promise<void>;
  /** 批量调整成活率等级（人工复核） */
  bulkApplyGrade: (level: RateLevel) => Promise<number>;
  /** 按最新测次生成补植计划（回写地块缺株数） */
  generateReplant: (plotId: string) => Promise<string>;
  summaryOf: (plotId: string | null) => SurvivalSummary;
  rateStats: () => { total: number; warnCount: number; avgRate: number };
}

/** 验收当天的栽植总株数：栽植日期不晚于验收日期的合计，查不到时按现有总数估算 */
function plantedTotalAt(plotId: string, date: string): number {
  return plantedTotalOn(usePlotStore.getState().plantings, plotId, date);
}

export const useSurveyStore = create<SurveyStoreState>((set, get) => ({
  filters: { ...EMPTY_FILTERS },
  selectedIds: [],
  gradeDraft: 'good',
  revision: 0,
  lastMessage: '',

  async init() {
    await initDatabase();
    set({ revision: get().revision + 1 });
  },

  setFilters(patch) {
    set({ filters: { ...get().filters, ...patch } });
  },

  resetFilters() {
    set({ filters: { ...EMPTY_FILTERS }, selectedIds: [] });
  },

  setSelectedIds(ids) {
    set({ selectedIds: [...ids] });
  },

  setGradeDraft(level) {
    set({ gradeDraft: level });
  },

  async createSurvey(draft) {
    // 保存测次时快照验收当天的栽植总株数作为分母，之后台账新增栽植不再影响本测次
    const plantedTotal = plantedTotalAt(draft.plotId, draft.date);
    const survivalRate = calcSurvivalRate(draft.aliveCount, plantedTotal);
    const stamp = nowIso();
    const row: Survey = {
      id: uuid('survey'),
      plotId: draft.plotId,
      round: draft.round,
      date: draft.date,
      aliveCount: draft.aliveCount,
      avgHeightCm: draft.avgHeightCm,
      plantedTotal,
      replantBoost: 0,
      survivalRate,
      grade: rateLevel(survivalRate),
      gradeManual: false,
      createdAt: stamp,
      updatedAt: stamp,
      revision: ROW_REVISION,
    };
    await putSurvey(row);
    set({ revision: get().revision + 1 });
    return row;
  },

  async updateSurvey(surveyId, draft) {
    const existing = await db.surveys.get(surveyId);
    if (!existing) return;
    // 已定测次的分母保持冻结；仅当换了地块或老数据缺失分母时才按验收日期重估
    const locked =
      existing.plotId === draft.plotId && typeof existing.plantedTotal === 'number' && existing.plantedTotal > 0;
    const plantedTotal = locked ? existing.plantedTotal : plantedTotalAt(draft.plotId, draft.date);
    const replantBoost = typeof existing.replantBoost === 'number' ? existing.replantBoost : 0;
    const survivalRate = calcSurvivalRate(draft.aliveCount + replantBoost, plantedTotal);
    await putSurvey({
      ...existing,
      plotId: draft.plotId,
      round: draft.round,
      date: draft.date,
      aliveCount: draft.aliveCount,
      avgHeightCm: draft.avgHeightCm,
      plantedTotal,
      replantBoost,
      survivalRate,
    });
    set({ revision: get().revision + 1 });
  },

  async deleteSurvey(surveyId) {
    await removeSurvey(surveyId);
    set({ selectedIds: get().selectedIds.filter((id) => id !== surveyId), revision: get().revision + 1 });
  },

  async bulkApplyGrade(level) {
    const ids = get().selectedIds;
    if (ids.length === 0) return 0;
    // 人工复核只改写等级标注，不改写实测成活率数值，保证数据可追溯
    await patchSurveyGrades(ids, level);
    set({ revision: get().revision + 1, lastMessage: `已批量调整 ${ids.length} 条验收记录的成活率等级` });
    return ids.length;
  },

  async generateReplant(plotId) {
    const summary = get().summaryOf(plotId);
    const plot = usePlotStore.getState().plots.find((row) => row.id === plotId);
    if (!plot) return '地块不存在，无法生成补植计划';
    const missing = summary.suggestReplant;
    if (missing <= 0) return '该地块当前无缺株，无需生成补植计划';
    const species = usePlotStore.getState().seedlings.find((row) => row.plotId === plotId)?.species ?? '秋茄';
    const stamp = nowIso();
    await db.replants.put({
      id: uuid('replant'),
      plotId,
      missingCount: missing,
      planDate: new Date(Date.now() + 15 * 24 * 3600 * 1000).toISOString().slice(0, 10),
      species,
      state: '待补植',
      createdAt: stamp,
      updatedAt: stamp,
      revision: ROW_REVISION,
    });
    set({ revision: get().revision + 1, lastMessage: `已为「${plot.name}」生成补植计划：缺株 ${missing} 株` });
    return `已生成补植计划：缺株 ${missing} 株`;
  },

  summaryOf(plotId) {
    return usePlotStore.getState().summaryOf(plotId);
  },

  rateStats() {
    const { summaries } = usePlotStore.getState();
    const list = Object.values(summaries);
    const withSurvey = list.filter((item) => item.latest !== null);
    if (withSurvey.length === 0) return { total: 0, warnCount: 0, avgRate: 0 };
    const sum = withSurvey.reduce((acc, item) => acc + item.latestRate, 0);
    return {
      total: withSurvey.length,
      warnCount: withSurvey.filter((item) => item.warn).length,
      avgRate: Math.round((sum / withSurvey.length) * 10) / 10,
    };
  },
}));
