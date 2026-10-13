import type { Expense } from '../types.js';

export type SortField = 'date' | 'amount' | 'category';

export interface ListFilters {
  search: string;
  sortBy: SortField;
  sortDir: 'asc' | 'desc';
  dateFrom: string;
  dateTo: string;
  amountMin: string;
  amountMax: string;
  categories: string[];
  contributors: string[];
  recurringOnly: boolean;
}

export function defaultListFilters(): ListFilters {
  return {
    search: '',
    sortBy: 'date',
    sortDir: 'desc',
    dateFrom: '',
    dateTo: '',
    amountMin: '',
    amountMax: '',
    categories: [],
    contributors: [],
    recurringOnly: false,
  };
}

/** Number of narrowing filters in effect (search and sort are not counted). */
export function countActiveFilters(f: ListFilters): number {
  return (f.dateFrom ? 1 : 0) +
    (f.dateTo ? 1 : 0) +
    (f.amountMin ? 1 : 0) +
    (f.amountMax ? 1 : 0) +
    (f.categories.length > 0 ? 1 : 0) +
    (f.contributors.length > 0 ? 1 : 0) +
    (f.recurringOnly ? 1 : 0);
}

export function applyListFilters(source: Expense[], f: ListFilters): Expense[] {
  let items = [...source];

  if (f.search.trim()) {
    const q = f.search.toLowerCase();
    items = items.filter(i =>
      (i.category?.toLowerCase().includes(q)) ||
      (i.name?.toLowerCase().includes(q)) ||
      (i.note?.toLowerCase().includes(q)) ||
      (i.familyMember?.toLowerCase().includes(q)) ||
      (i.authorNickname?.toLowerCase().includes(q))
    );
  }

  if (f.dateFrom) items = items.filter(i => i.date >= f.dateFrom);
  if (f.dateTo) items = items.filter(i => i.date <= f.dateTo);

  const min = parseFloat(f.amountMin);
  if (!Number.isNaN(min)) items = items.filter(i => i.amount >= min);
  const max = parseFloat(f.amountMax);
  if (!Number.isNaN(max)) items = items.filter(i => i.amount <= max);

  if (f.categories.length > 0) {
    items = items.filter(i => f.categories.includes(i.category));
  }

  if (f.contributors.length > 0) {
    items = items.filter(i => {
      const contributor = i.authorNickname || i.familyMember;
      return !!contributor && f.contributors.includes(contributor);
    });
  }

  if (f.recurringOnly) items = items.filter(i => !!i.recurrence);

  items.sort((a, b) => {
    let cmp = 0;
    if (f.sortBy === 'date') {
      cmp = a.date.localeCompare(b.date);
    } else if (f.sortBy === 'amount') {
      cmp = a.amount - b.amount;
    } else if (f.sortBy === 'category') {
      cmp = (a.category || '').localeCompare(b.category || '');
    }
    return f.sortDir === 'desc' ? -cmp : cmp;
  });

  return items;
}
