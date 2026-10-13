<script lang="ts">
  import { untrack } from 'svelte';
  import { getExpense, getCurrentCurrency, removeExpenseItem, getExpenseTrendRange, setExpenseTrendRange, getCurrentSpaceId, getViewMode, navigate, confirmDialog } from '../lib/state.svelte.js';
  import { calculateExpenseSummary, calculateExpenseByCategory, calculateMemberBreakdown } from '../lib/calculations.svelte.js';
  import { calculateExpenseTrendData } from '../lib/utils.js';
  import { applyListFilters, countActiveFilters, defaultListFilters } from '../lib/listFilters.js';
  import { formatMoney } from '../lib/currency.js';
  import { deleteExpenseOnServer } from '../lib/api.js';
  import { t } from '../lib/i18n.svelte.js';
  import type { Expense, ExpenseSummary, CategoryData, TrendPoint } from '../types.js';
  import BudgetOverview from '../components/BudgetOverview.svelte';
  import RecurringUpcoming from '../components/RecurringUpcoming.svelte';
  import PieChart from '../components/PieChart.svelte';
  import TopCategories from '../components/TopCategories.svelte';
  import TrendChart from '../components/TrendChart.svelte';
  import ExpenseItem from '../components/ExpenseItem.svelte';
  import MemberBreakdown from '../components/MemberBreakdown.svelte';
  import ModeDropdown from '../components/ModeDropdown.svelte';
  import ListFiltersDropdown from '../components/ListFiltersDropdown.svelte';

  let mode = $derived(getViewMode());

  let summary = $state<ExpenseSummary>({ total: 0, count: 0, average: 0 });
  let categoryData = $state<CategoryData[]>([]);
  let categoryTotal = $state<number>(0);
  let trendPoints = $state<TrendPoint[]>([]);
  let trendTotal = $state<number>(0);
  let trendAverage = $state<number>(0);
  let trendPeriodLabel = $state<string>('');
  let expenseItems = $state<Expense[]>([]);
  let recentExpenses = $state<Expense[]>([]);
  let trendRange = $state<string>(getExpenseTrendRange());
  let memberData = $state<CategoryData[]>([]);
  let memberTotal = $state<number>(0);
  let inSpace = $derived(!!getCurrentSpaceId());

  // List mode: search, sort and every filter live in one dropdown.
  let filters = $state(defaultListFilters());
  let displayedItems = $derived(applyListFilters(expenseItems, filters));
  let activeFilterCount = $derived(countActiveFilters(filters));

  function selectMode(m: 'overview' | 'list') {
    navigate(m === 'list' ? '/expense/list' : '/expense');
  }

  async function refresh() {
    const expense = getExpense();
    const currency = getCurrentCurrency();
    expenseItems = expense.filter(i => i.type === 'expense');
    const [s, c, tr, m] = await Promise.all([
      calculateExpenseSummary(expense, currency),
      calculateExpenseByCategory(expense, currency),
      calculateExpenseTrendData(expense, trendRange, currency),
      calculateMemberBreakdown(expenseItems, currency)
    ]);
    if (cancelled) return;
    summary = s;
    categoryData = c.data;
    categoryTotal = c.total;
    trendPoints = tr.points;
    trendTotal = tr.total;
    trendAverage = tr.average;
    trendPeriodLabel = tr.periodLabel;
    recentExpenses = expenseItems.slice(0, 10);
    memberData = m.data;
    memberTotal = m.total;
  }

  let cancelled = $state<boolean>(false);

  $effect(() => {
    cancelled = false;
    getExpense();
    getCurrentCurrency();
    trendRange;
    untrack(() => refresh());
    return () => { cancelled = true; };
  });

  function handleTrendChange(r: string) {
    trendRange = r;
    setExpenseTrendRange(r);
  }

  function handleEdit(item: Expense) {
    const ev = new CustomEvent<Expense>('edit-expense', { detail: item });
    window.dispatchEvent(ev);
  }

  async function handleDelete(id: string) {
    if (await confirmDialog(t('expense.deleteConfirm'))) {
      const deleted = await deleteExpenseOnServer(id);
      if (deleted) {
        removeExpenseItem(id);
      } else {
        alert(t('expense.unableDelete'));
      }
    }
  }
</script>

<div class="space-y-6">
  <div class="flex flex-wrap items-center gap-3">
    <ModeDropdown {mode} overviewLabel={t('expense.modeOverview')} listLabel={t('expense.modeList')} ariaLabel={t('expense.viewMode')} onselect={selectMode} />

    {#if mode === 'list'}
      <ListFiltersDropdown bind:filters type="expense" items={expenseItems} searchPlaceholder={t('expense.searchPlaceholder')} idPrefix="expense" />
    {/if}
  </div>

  {#if mode === 'overview'}
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div class="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-5">
        <p class="text-sm text-slate-500 dark:text-slate-400">{t('expense.total')}</p>
        <p class="text-2xl font-bold text-rose-600">{formatMoney(summary.total, getCurrentCurrency())}</p>
      </div>
      <div class="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-5">
        <p class="text-sm text-slate-500 dark:text-slate-400">{t('expense.entries')}</p>
        <p class="text-2xl font-bold text-slate-800 dark:text-slate-100">{summary.count}</p>
      </div>
      <div class="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-5">
        <p class="text-sm text-slate-500 dark:text-slate-400">{t('expense.average')}</p>
        <p class="text-2xl font-bold text-orange-600">{formatMoney(summary.average, getCurrentCurrency())}</p>
      </div>
    </div>

    <BudgetOverview />

    <RecurringUpcoming type="expense" />

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <PieChart {categoryData} total={categoryTotal} currency={getCurrentCurrency()} />
      <TopCategories {categoryData} total={categoryTotal} currency={getCurrentCurrency()} />
    </div>

    <TrendChart points={trendPoints} total={trendTotal} average={trendAverage} periodLabel={trendPeriodLabel} currency={getCurrentCurrency()} range={trendRange} onRangeChange={handleTrendChange} />

    {#if inSpace}
      <MemberBreakdown {memberData} total={memberTotal} currency={getCurrentCurrency()} />
    {/if}

    <div class="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold text-slate-800 dark:text-slate-100">{t('expense.recentExpenses')}</h2>
        <button onclick={() => selectMode('list')} class="text-xs font-medium text-blue-600 hover:underline cursor-pointer">
          {t('expense.modeList')}
        </button>
      </div>
      {#if recentExpenses.length === 0}
        <p class="text-slate-500 dark:text-slate-400 text-center py-8">{t('expense.noEntriesYet')}</p>
      {:else}
        <ul class="space-y-2">
          {#each recentExpenses as item (item.id)}
            <ExpenseItem {item}
              options={{
                showTypeBadge: false,
                useTypeIcon: true,
                iconBgClass: 'bg-rose-100',
                iconColorClass: 'text-rose-600',
                amountColorClass: 'text-rose-600',
                amountPrefix: ''
              }}
              onedit={() => {}}
              ondelete={handleDelete} />
          {/each}
        </ul>
      {/if}
    </div>
  {:else}
    <div class="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6">
      {#if displayedItems.length === 0}
        <p class="text-slate-500 dark:text-slate-400 text-center py-8">{filters.search || activeFilterCount > 0 ? t('expense.noMatching') : t('expense.noEntriesYet')}</p>
      {:else}
        <ul class="space-y-2">
          {#each displayedItems as item (item.id)}
            <ExpenseItem {item}
              options={{
                showTypeBadge: false,
                useTypeIcon: true,
                iconBgClass: 'bg-rose-100',
                iconColorClass: 'text-rose-600',
                amountColorClass: 'text-rose-600',
                amountPrefix: '-'
              }}
              onedit={handleEdit}
              ondelete={handleDelete} />
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>
