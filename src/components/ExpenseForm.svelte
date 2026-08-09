<script lang="ts">
  import { onMount } from 'svelte';
  import { saveTransaction, parseReceiptsBulk, switchSpace, uploadBulkExpenses, loadExpenses } from '../lib/api.js';
  import { getAllCategories, getSpaces, getCurrentSpaceId } from '../lib/state.svelte.js';
  import { compressImageToDataUrl } from '../lib/utils.js';
  import { t } from '../lib/i18n.svelte.js';
  import { getFlatpickrLocale } from '../lib/flatpickrLocale.js';
  import type { Expense, Recurrence } from '../types.js';
  import BulkImportModal from './BulkImportModal.svelte';
  import CategorySelect from './CategorySelect.svelte';

  let { onadd } = $props<{ onadd?: (item: Expense) => void }>();

  let type = $state<'income' | 'expense'>('expense');
  let amount = $state<string>('');
  let category = $state<string>('Food & Dining');
  let date = $state<string>(new Date().toISOString().split('T')[0]);
  let note = $state<string>('');
  let submitting = $state<boolean>(false);
  let fpInstance = $state<any>(null);
  let endDateFp = $state<any>(null);
  let dateInputEl = $state<HTMLInputElement | null>(null);
  let endDateInputEl = $state<HTMLInputElement | null>(null);

  // Recurrence state
  let isRecurring = $state<boolean>(false);
  let recurrenceFrequency = $state<'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly'>('monthly');
  let recurrenceEndDate = $state<string>('');

  let receiptProcessing = $state<boolean>(false);
  let receiptProgress = $state<string>('');
  let parsedReceipts = $state<any[]>([]);
  let showBulkModal = $state<boolean>(false);
  let ocrPro = $state<boolean>(false);

  let categories = $derived(getAllCategories(type));
  let spaces = $derived(getSpaces());
  let currentSpaceId = $derived(getCurrentSpaceId());
  let switchingSpace = $state<boolean>(false);

  $effect(() => {
    if (categories.length > 0 && !categories.includes(category)) {
      category = categories[0];
    }
  });

  async function handleSpaceChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value;
    switchingSpace = true;
    try {
      await switchSpace(value || null);
    } finally {
      switchingSpace = false;
    }
  }

  onMount(() => {
    if (dateInputEl) {
      import('flatpickr').then(async (mod) => {
        fpInstance = mod.default(dateInputEl as HTMLElement, {
          dateFormat: 'Y-m-d',
          altInput: true,
          altFormat: 'd/m/Y',
          locale: await getFlatpickrLocale(mod.default),
          defaultDate: date,
          onChange: (selectedDates: Date[]) => {
            if (selectedDates[0]) {
              date = selectedDates[0].toISOString().split('T')[0];
            }
          }
        });
      });
    }
    return () => {
      fpInstance?.destroy();
      endDateFp?.destroy();
    };
  });

  $effect(() => {
    if (endDateInputEl && isRecurring && !endDateFp) {
      import('flatpickr').then(async (mod) => {
        endDateFp = mod.default(endDateInputEl as HTMLElement, {
          dateFormat: 'Y-m-d',
          altInput: true,
          altFormat: 'd/m/Y',
          locale: await getFlatpickrLocale(mod.default),
          disableMobile: true,
          defaultDate: recurrenceEndDate || undefined,
          onChange: (selectedDates: Date[]) => {
            if (selectedDates[0]) {
              recurrenceEndDate = selectedDates[0].toISOString().split('T')[0];
            }
          }
        });
      });
    }
  });

  async function handleSubmit() {
    if (!type || !amount || !category || !date) return;
    submitting = true;

    let recurrence: Recurrence | null = null;
    if (isRecurring) {
      recurrence = {
        frequency: recurrenceFrequency,
        nextDueDate: date,
        endDate: recurrenceEndDate || null,
        isActive: true,
      };
    }

    const result = await saveTransaction({
      type,
      amount: parseFloat(amount),
      category,
      date,
      note,
      recurrence,
    });
    submitting = false;
    if (result) {
      amount = '';
      note = '';
      date = new Date().toISOString().split('T')[0];
      isRecurring = false;
      recurrenceFrequency = 'monthly';
      recurrenceEndDate = '';
      if (fpInstance) fpInstance.setDate(date);
      onadd?.(result);
    }
  }

  async function handleBulkReceiptUpload(e: Event) {
    const target = e.target as HTMLInputElement;
    const files = Array.from(target.files ?? []);
    if (!files.length) return;
    receiptProcessing = true;
    receiptProgress = t('form.compressingReceipts', { count: files.length });
    const dataUrls = await Promise.all(
      files.map((f: File) => compressImageToDataUrl(f, 1920, 0.7))
    );
    receiptProgress = t('form.processingReceipts', { count: dataUrls.length });
    try {
      const data = await parseReceiptsBulk(dataUrls, ocrPro);
      receiptProgress = '';
      const flat: Array<{ type: 'income' | 'expense'; amount: number; category: string; date: string; note: string }> = [];
      const today = new Date().toISOString().split('T')[0];
      for (const r of data.results ?? []) {
        if (r.error) continue;
        for (const item of r.items ?? []) {
          flat.push({
            type: (item.type === 'income' || item.type === 'expense') ? item.type : 'expense',
            amount: item.amount,
            category: item.category || 'Other',
            date: r.date || today,
            note: item.name || item.note || '',
          });
        }
      }
      if (flat.length > 0) {
        parsedReceipts = flat;
        showBulkModal = true;
      } else {
        alert(t('form.noReceiptData'));
      }
    } catch (err) {
      console.error('Bulk receipt parse failed:', err);
      receiptProgress = '';
      alert(t('form.receiptFailed'));
    }
    receiptProcessing = false;
    target.value = '';
  }

  // CSV import handlers
  function triggerCsvImport() {
    csvFileInput?.click();
  }

  async function handleCsvFileSelect(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    csvImporting = true;
    csvResult = null;
    try {
      const text = await file.text();
      const lines = text.trim().split('\n');
      if (lines.length < 2) {
        csvResult = { success: false, message: t('form.csvEmpty') };
        return;
      }
      const headers = lines[0].split(',').map((h: string) => h.trim().toLowerCase());
      const rows = lines.slice(1).filter((l: string) => l.trim()).map((line: string) => {
        const values = line.split(',').map((v: string) => v.trim());
        const obj: Record<string, string> = {};
        headers.forEach((h: string, i: number) => obj[h] = values[i] || '');
        return obj;
      });
      const res = await uploadBulkExpenses(rows);
      await loadExpenses();
      csvResult = { success: true, message: t('form.csvImported', { count: res.count || rows.length }) };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : t('form.csvImportFailed');
      csvResult = { success: false, message: errorMessage };
    } finally {
      csvImporting = false;
      input.value = '';
    }
  }

  function handleBulkSave(saved: any[]) {
    showBulkModal = false;
    parsedReceipts = [];
    for (const item of saved) {
      onadd?.(item as Expense);
    }
  }

  // CSV import
  let csvImporting = $state<boolean>(false);
  let csvResult = $state<{ success: boolean; message: string } | null>(null);
  let csvFileInput = $state<HTMLInputElement | null>(null);

  let receiptInput = $state<HTMLInputElement | null>(null);

  function triggerReceiptUpload() {
    receiptInput?.click();
  }
</script>

<div class="bg-white dark:bg-slate-800 rounded-xl shadow-sm p-6 animate-fade-in">
  <div class="flex items-center gap-2 mb-6">
    <i class="ph ph-plus-circle text-xl text-blue-600"></i>
    <h2 class="text-lg font-semibold text-slate-800 dark:text-slate-100">{t('form.addTransaction')}</h2>
  </div>

  <div class="flex gap-4 mb-4">
    <label class="flex items-center gap-2 cursor-pointer">
      <input type="radio" bind:group={type} value="expense" class="text-rose-500 focus:ring-rose-400" />
      <span class="text-sm font-medium text-slate-700 dark:text-slate-300">{t('type.expense')}</span>
    </label>
    <label class="flex items-center gap-2 cursor-pointer">
      <input type="radio" bind:group={type} value="income" class="text-emerald-500 focus:ring-emerald-400" />
      <span class="text-sm font-medium text-slate-700 dark:text-slate-300">{t('type.income')}</span>
    </label>
  </div>

  {#if spaces.length > 0}
    <div class="mb-4">
      <label for="expense-space" class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('form.space')}</label>
      <select
        id="expense-space"
        value={currentSpaceId ?? ''}
        onchange={handleSpaceChange}
        disabled={switchingSpace}
        class="input-field w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-800 dark:text-slate-100 text-sm focus:outline-none disabled:opacity-60"
      >
        <option value="">{t('header.personal')}</option>
        {#each spaces as space}
          <option value={space.id}>{space.name}</option>
        {/each}
      </select>
    </div>
  {/if}

  <div class="space-y-4">
    <div>
      <label for="expense-amount" class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('form.amount')}</label>
      <input id="expense-amount" type="number" step="0.01" bind:value={amount} placeholder="0.00" class="input-field w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-800 dark:text-slate-100 text-sm focus:outline-none" />
    </div>

    <div>
      <label for="expense-category" class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('form.categoryType')}</label>
      <CategorySelect
        id="expense-category"
        type={type}
        bind:value={category}
        selectClass="input-field w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-800 dark:text-slate-100 text-sm focus:outline-none"
      />
    </div>

    <div>
      <label for="expense-date" class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('form.date')}</label>
      <input id="expense-date" bind:this={dateInputEl} type="text" bind:value={date} class="input-field w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-800 dark:text-slate-100 text-sm focus:outline-none" />
    </div>

    <div>
      <label for="expense-note" class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('form.note')}</label>
      <input id="expense-note" type="text" bind:value={note} placeholder={t('form.optionalNote')} class="input-field w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-800 dark:text-slate-100 text-sm focus:outline-none" />
    </div>

    <!-- Recurrence Toggle -->
    <div class="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-4 border border-slate-200 dark:border-slate-600">
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2">
          <i class="ph ph-repeat text-blue-600"></i>
          <span class="text-sm font-medium text-slate-700 dark:text-slate-300">{t('form.recurringTransaction')}</span>
        </div>
        <button type="button" onclick={() => isRecurring = !isRecurring} aria-label={t('form.recurringTransaction')}
          class="relative w-10 h-5 rounded-full transition-colors {isRecurring ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}">
          <div class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform {isRecurring ? 'translate-x-5' : ''}"></div>
        </button>
      </div>
      {#if isRecurring}
        <div class="space-y-3 mt-3 animate-fade-in">
          <div>
            <label for="expense-frequency" class="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{t('form.frequency')}</label>
            <div class="flex gap-1">
              {#each [
                { v: 'daily' as const, l: t('freq.daily') },
                { v: 'weekly' as const, l: t('freq.weekly') },
                { v: 'biweekly' as const, l: t('freq.biweekly') },
                { v: 'monthly' as const, l: t('freq.monthly') },
                { v: 'yearly' as const, l: t('freq.yearly') }
              ] as opt}
                <button type="button" onclick={() => recurrenceFrequency = opt.v}
                  class="px-2.5 py-1 text-xs rounded-md font-medium transition-colors {recurrenceFrequency === opt.v ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-500'}">
                  {opt.l}
                </button>
              {/each}
            </div>
          </div>
          <div>
            <label for="expense-enddate" class="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{t('form.endDateOptional')}</label>
            <input id="expense-enddate" bind:this={endDateInputEl} type="text" bind:value={recurrenceEndDate} placeholder={t('form.noEndDate')}
              class="input-field w-full px-3 py-1.5 bg-white dark:bg-slate-600 border border-slate-200 dark:border-slate-500 rounded-md text-slate-800 dark:text-slate-100 text-xs focus:outline-none" />
          </div>
        </div>
      {/if}
    </div>

    <button onclick={handleSubmit} disabled={submitting || !amount || !category} class="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-600 text-white font-medium rounded-lg transition-colors text-sm flex items-center justify-center gap-2 cursor-pointer">
      {#if submitting}
        <i class="ph ph-circle-notch animate-spin"></i>
      {/if}
      {t('form.add', { type: type === 'expense' ? t('type.expense') : t('type.income') })}
    </button>
  </div>

  <div class="mt-6 pt-6 border-t border-slate-100 dark:border-slate-700">
    <div class="flex items-center gap-2 mb-3">
      <i class="ph ph-lightning text-blue-600"></i>
      <h3 class="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('form.quickAdd')}</h3>
    </div>
    <div>
      <button onclick={triggerReceiptUpload} disabled={receiptProcessing} class="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer disabled:text-slate-300">
        <i class="ph ph-camera"></i>
        <span>{receiptProcessing ? t('form.importing') : t('form.importReceipts')}</span>
      </button>
      <div class="flex gap-2 mt-2">
        <label class="flex-1 flex flex-col gap-0.5 cursor-pointer border rounded-lg px-3 py-2 transition-colors {!ocrPro ? 'border-blue-300 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-slate-600'}">
          <span class="flex items-center gap-1.5">
            <input type="radio" name="ocrMode" checked={!ocrPro} onchange={() => ocrPro = false} class="text-blue-600 focus:ring-blue-500" />
            <span class="text-xs font-medium text-slate-700 dark:text-slate-200">{t('form.basicOcr', { count: 3 })}</span>
          </span>
          <span class="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">{t('form.basicOcrDesc')}</span>
        </label>
        <label class="flex-1 flex flex-col gap-0.5 cursor-pointer border rounded-lg px-3 py-2 transition-colors {ocrPro ? 'border-blue-300 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-slate-600'}">
          <span class="flex items-center gap-1.5">
            <input type="radio" name="ocrMode" checked={ocrPro} onchange={() => ocrPro = true} class="text-blue-600 focus:ring-blue-500" />
            <span class="text-xs font-medium text-slate-700 dark:text-slate-200">{t('form.proOcr', { count: 6 })}</span>
          </span>
          <span class="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">{t('form.proOcrDesc')}</span>
        </label>
      </div>
      <input bind:this={receiptInput} type="file" accept="image/*" multiple class="hidden" onchange={handleBulkReceiptUpload} />
      {#if receiptProgress}
        <div class="flex items-center gap-2 text-sm text-slate-500 mt-2">
          <i class="ph ph-circle-notch animate-spin"></i>
          <span>{receiptProgress}</span>
        </div>
      {/if}
    </div>

    <!-- CSV Import -->
    <div class="mt-4">
      <button onclick={triggerCsvImport} disabled={csvImporting} class="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer disabled:text-slate-300">
        <i class="ph ph-file-csv"></i>
        <span>{csvImporting ? t('form.importing') : t('form.importCsv')}</span>
      </button>
      <input bind:this={csvFileInput} type="file" accept=".csv" class="hidden" onchange={handleCsvFileSelect} />
      {#if csvImporting}
        <div class="flex items-center gap-2 text-sm text-slate-500 mt-2">
          <i class="ph ph-circle-notch animate-spin"></i>
          <span>{t('form.importingCsv')}</span>
        </div>
      {/if}
      {#if csvResult}
        <div class="mt-2 px-3 py-2 rounded-lg text-sm {csvResult.success ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' : 'bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300'}">
          {#if csvResult.success}
            <i class="ph ph-check-circle mr-1"></i>
          {:else}
            <i class="ph ph-x-circle mr-1"></i>
          {/if}
          {csvResult.message}
          {#if csvResult.success}
            <button onclick={() => csvResult = null} class="ml-2 text-blue-600 hover:underline">{t('common.ok')}</button>
          {:else}
            <button onclick={() => csvResult = null} class="ml-2 text-blue-600 hover:underline">{t('common.dismiss')}</button>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>

<BulkImportModal
  show={showBulkModal}
  results={parsedReceipts}
  onclose={() => { showBulkModal = false; parsedReceipts = []; }}
  onsave={handleBulkSave}
/>
