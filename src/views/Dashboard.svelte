<script lang="ts">
  import { untrack } from 'svelte';
  import { getExpense, getCurrentCurrency, addExpenseItem, removeExpenseItem, getDashboardTrendRange, setDashboardTrendRange, getCurrentSpaceId, confirmDialog } from '../lib/state.svelte.js';
  import { calculateExpenseSummary, calculateExpenseByCategory, calculateMemberBreakdown } from '../lib/calculations.svelte.js';
  import { calculateExpenseTrendData } from '../lib/utils.js';
  import { formatMoney } from '../lib/currency.js';
  import { saveTransaction, deleteExpenseOnServer } from '../lib/api.js';
  import type { Expense, ExpenseSummary, CategoryData, TrendPoint } from '../types.js';
  import { t } from '../lib/i18n.svelte.js';
  import BudgetOverview from '../components/BudgetOverview.svelte';
  import ExpenseForm from '../components/ExpenseForm.svelte';
  import PieChart from '../components/PieChart.svelte';
  import TrendChart from '../components/TrendChart.svelte';
  import ExpenseItem from '../components/ExpenseItem.svelte';
  import RecurringUpcoming from '../components/RecurringUpcoming.svelte';
  import MemberBreakdown from '../components/MemberBreakdown.svelte';

  let summary = $state<ExpenseSummary>({ total: 0, count: 0, average: 0 });
  let categoryData = $state<CategoryData[]>([]);
  let categoryTotal = $state<number>(0);
  let trendPoints = $state<TrendPoint[]>([]);
  let trendTotal = $state<number>(0);
  let trendAverage = $state<number>(0);
  let trendPeriodLabel = $state<string>('');
  let recentExpenses = $state<Expense[]>([]);
  let trendRange = $state<string>(getDashboardTrendRange());
  let memberData = $state<CategoryData[]>([]);
  let memberTotal = $state<number>(0);
  let inSpace = $derived(!!getCurrentSpaceId());

  async function refresh() {
    const expense = getExpense();
    const currency = getCurrentCurrency();
    const expenseOnly = expense.filter(i => i.type === 'expense');
    const [s, c, t, m] = await Promise.all([
      calculateExpenseSummary(expense, currency),
      calculateExpenseByCategory(expense, currency),
      calculateExpenseTrendData(expense, trendRange, currency),
      calculateMemberBreakdown(expenseOnly, currency)
    ]);
    if (cancelled) return;
    summary = s;
    categoryData = c.data;
    categoryTotal = c.total;
    trendPoints = t.points;
    trendTotal = t.total;
    trendAverage = t.average;
    trendPeriodLabel = t.periodLabel;
    recentExpenses = expenseOnly.slice(0, 10);
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
    setDashboardTrendRange(r);
  }

  async function handleAdd(saved: Expense | null) {
    if (saved) addExpenseItem(saved);
  }

  async function handleDelete(id: string) {
    if (await confirmDialog(t('dashboard.deleteItem'))) {
      const deleted = await deleteExpenseOnServer(id);
      if (deleted) {
        removeExpenseItem(id);
      } else {
        alert(t('dashboard.unableDelete'));
      }
    }
  }
</script>

<div class="space-y-6">
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

  <ExpenseForm onadd={handleAdd} />

  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <PieChart {categoryData} total={categoryTotal} currency={getCurrentCurrency()} />
    <TrendChart points={trendPoints} total={trendTotal} average={trendAverage} periodLabel={trendPeriodLabel} currency={getCurrentCurrency()} range={trendRange} onRangeChange={handleTrendChange} />
  </div>

  {#if inSpace}
    <MemberBreakdown {memberData} total={memberTotal} currency={getCurrentCurrency()} />
  {/if}

  <div class="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6">
    <h2 class="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4">{t('dashboard.recentExpenses')}</h2>
    {#if recentExpenses.length === 0}
      <p class="text-slate-500 dark:text-slate-400 text-center py-8">{t('dashboard.noExpensesYet')}</p>
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
</div>
