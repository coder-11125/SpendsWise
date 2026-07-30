<script lang="ts">
  import { onMount } from 'svelte';
  import { saveTransaction, switchSpace, uploadBulkExpenses, loadExpenses, parseReceiptsBulk } from '../lib/api.js';
  import { addExpenseItem, getCurrentCurrency, getSpaces, getCurrentSpaceId } from '../lib/state.svelte.js';
  import { getCurrencySymbol } from '../lib/currency.js';
  import { compressImageToDataUrl } from '../lib/utils.js';
  import CategorySelect from './CategorySelect.svelte';
  import BulkImportModal from './BulkImportModal.svelte';

  let { show, onclose } = $props();

  const currencySymbol = $derived(getCurrencySymbol(getCurrentCurrency()));

  let type = $state('expense');
  let amount = $state(0);
  let category = $state('');
  let date = $state(new Date().toISOString().split('T')[0]);
  let note = $state('');
  let loading = $state(false);
  let error = $state('');

  let dateInput = $state(null);
  let fp = $state(null);

  let spaces = $derived(getSpaces());
  let currentSpaceId = $derived(getCurrentSpaceId());
  let switchingSpace = $state(false);

  // CSV import
  let csvImporting = $state(false);
  let csvResult = $state<{ success: boolean; message: string } | null>(null);
  let csvFileInput: HTMLInputElement;

  // Receipt / OCR import
  let receiptProcessing = $state(false);
  let receiptProgress = $state('');
  let parsedReceipts = $state<any[]>([]);
  let showBulkModal = $state(false);
  let ocrPro = $state(false);
  let receiptInput: HTMLInputElement;

  async function handleSpaceChange(e) {
    const value = e.target.value;
    switchingSpace = true;
    try {
      await switchSpace(value || null);
    } finally {
      switchingSpace = false;
    }
  }

  $effect(() => {
    if (dateInput && !fp) {
      import('flatpickr').then((mod) => {
        fp = mod.default(dateInput, {
          dateFormat: 'Y-m-d',
          altInput: true,
          altFormat: 'd/m/Y',
          disableMobile: true,
          defaultDate: date || 'today',
        });
      });
    }
  });

  async function handleSubmit(e) {
    e.preventDefault();
    error = '';
    if (!type || Number.isNaN(amount) || !category || !date) {
      error = 'Please fill in all required fields.';
      return;
    }
    loading = true;
    try {
      const entry = await saveTransaction({ type, amount, category, date, note });
      if (entry) {
        addExpenseItem(entry);
        type = 'expense';
        amount = 0;
        category = '';
        date = new Date().toISOString().split('T')[0];
        note = '';
        onclose?.();
      } else {
        error = 'Failed to save expense.';
      }
    } catch (err) {
      error = 'Network error. Please try again.';
    } finally {
      loading = false;
    }
  }

  // CSV import handlers
  function triggerCsvImport() {
    csvFileInput?.click();
  }

  async function handleCsvFileSelect(ev) {
    const file = ev.target.files[0];
    if (!file) return;
    csvImporting = true;
    csvResult = null;
    try {
      const text = await file.text();
      const lines = text.trim().split('\n');
      if (lines.length < 2) {
        csvResult = { success: false, message: 'CSV file is empty or has no data rows.' };
        return;
      }
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      const rows = lines.slice(1).filter(l => l.trim()).map(line => {
        const values = line.split(',').map(v => v.trim());
        const obj = {};
        headers.forEach((h, i) => obj[h] = values[i] || '');
        return obj;
      });
      const res = await uploadBulkExpenses(rows);
      await loadExpenses();
      csvResult = { success: true, message: `Successfully imported ${res.count || rows.length} item(s).` };
    } catch (err) {
      csvResult = { success: false, message: err.message || 'Failed to import CSV.' };
    } finally {
      csvImporting = false;
      ev.target.value = '';
    }
  }

  // Receipt import handlers
  async function handleBulkReceiptUpload(e) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    receiptProcessing = true;
    receiptProgress = `Compressing ${files.length} receipt${files.length > 1 ? 's' : ''}...`;
    const dataUrls = await Promise.all(
      files.map((f) => compressImageToDataUrl(f, 1920, 0.7))
    );
    receiptProgress = `Processing ${dataUrls.length} receipt${dataUrls.length > 1 ? 's' : ''}...`;
    try {
      const data = await parseReceiptsBulk(dataUrls, ocrPro);
      receiptProgress = '';
      const flat: any[] = [];
      const today = new Date().toISOString().split('T')[0];
      for (const r of data.results ?? []) {
        if (r.error) continue;
        for (const item of r.items ?? []) {
          flat.push({
            type: item.type || 'expense',
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
        alert('Could not extract data from any of the receipts.');
      }
    } catch (err) {
      console.error('Bulk receipt parse failed:', err);
      receiptProgress = '';
      alert('Failed to process receipts. Please try again.');
    }
    receiptProcessing = false;
    e.target.value = '';
  }

  function handleBulkSave(saved: any[]) {
    showBulkModal = false;
    parsedReceipts = [];
    for (const item of saved) {
      addExpenseItem(item);
    }
  }

  function triggerReceiptUpload() {
    receiptInput?.click();
  }
</script>

{#if show}
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fade-in" onclick={(e) => { if (e.target === e.currentTarget) onclose?.(); }}>
    <div class="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-bold text-slate-800">Quick Add</h2>
        <button onclick={() => onclose?.()} class="text-slate-400 hover:text-slate-600 transition-colors">
          <i class="ph ph-x text-xl"></i>
        </button>
      </div>

      <form onsubmit={handleSubmit} class="space-y-4">
        <div class="flex gap-3">
          <label class="flex-1 flex items-center justify-center gap-2 cursor-pointer border {type === 'expense' ? 'border-rose-300 bg-rose-50' : 'border-slate-200'} rounded-lg py-2.5 transition-colors">
            <input type="radio" name="mqType" value="expense" bind:group={type} class="sr-only" />
            <i class="ph ph-trend-down {type === 'expense' ? 'text-rose-600' : 'text-slate-400'}"></i>
            <span class="text-sm font-medium {type === 'expense' ? 'text-rose-600' : 'text-slate-600'}">Expense</span>
          </label>
          <label class="flex-1 flex items-center justify-center gap-2 cursor-pointer border {type === 'income' ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200'} rounded-lg py-2.5 transition-colors">
            <input type="radio" name="mqType" value="income" bind:group={type} class="sr-only" />
            <i class="ph ph-trend-up {type === 'income' ? 'text-emerald-600' : 'text-slate-400'}"></i>
            <span class="text-sm font-medium {type === 'income' ? 'text-emerald-600' : 'text-slate-600'}">Income</span>
          </label>
        </div>

        {#if spaces.length > 0}
          <div>
            <label for="mqSpace" class="block text-sm font-medium text-slate-700 mb-1">Space</label>
            <select
              id="mqSpace"
              value={currentSpaceId ?? ''}
              onchange={handleSpaceChange}
              disabled={switchingSpace}
              class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:opacity-60"
            >
              <option value="">Personal</option>
              {#each spaces as space}
                <option value={space.id}>{space.name}</option>
              {/each}
            </select>
          </div>
        {/if}

        <div>
          <label for="mqAmount" class="block text-sm font-medium text-slate-700 mb-1">Amount</label>
          <div class="relative">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-medium">{currencySymbol}</span>
            <input
              id="mqAmount"
              type="number"
              step="0.01"
              min="0"
              bind:value={amount}
              placeholder="0.00"
              class="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
        </div>

        <div>
          <label for="mqCategory" class="block text-sm font-medium text-slate-700 mb-1">Type</label>
          <CategorySelect
            id="mqCategory"
            type={type}
            bind:value={category}
            selectClass="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>

        <div>
          <label for="mqDate" class="block text-sm font-medium text-slate-700 mb-1">Date</label>
          <input
            id="mqDate"
            bind:this={dateInput}
            bind:value={date}
            class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>

        <div>
          <label for="mqNote" class="block text-sm font-medium text-slate-700 mb-1">Note</label>
          <input
            id="mqNote"
            type="text"
            bind:value={note}
            placeholder="Optional note..."
            class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>

        {#if error}
          <p class="text-sm text-rose-600 bg-rose-50 px-3 py-2 rounded-lg">{error}</p>
        {/if}

        <button
          type="submit"
          disabled={loading}
          class="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
        >
          {#if loading}
            <i class="ph ph-spinner animate-spin"></i>
            Adding...
          {:else}
            <i class="ph ph-plus-circle"></i>
            Add Entry
          {/if}
        </button>
      </form>

      <!-- Import section -->
      <div class="mt-6 pt-6 border-t border-slate-200">
        <div class="flex items-center gap-2 mb-3">
          <i class="ph ph-lightning text-blue-600"></i>
          <h3 class="text-sm font-semibold text-slate-700">Import</h3>
        </div>

        <!-- Receipt / OCR import -->
        <div class="mb-3">
          <button onclick={triggerReceiptUpload} disabled={receiptProcessing} class="flex items-center gap-2 text-sm text-slate-600 hover:text-blue-600 transition-colors cursor-pointer disabled:text-slate-300">
            <i class="ph ph-camera"></i>
            <span>{receiptProcessing ? 'Importing...' : 'Import Receipts'}</span>
          </button>
          <div class="flex gap-2 mt-2">
            <label class="flex-1 flex flex-col gap-0.5 cursor-pointer border rounded-lg px-3 py-2 transition-colors {!ocrPro ? 'border-blue-300 bg-blue-50' : 'border-slate-200'}">
              <span class="flex items-center gap-1.5">
                <input type="radio" name="ocrMode" checked={!ocrPro} onchange={() => ocrPro = false} class="text-blue-600 focus:ring-blue-500" />
                <span class="text-xs font-medium text-slate-700">Basic OCR <span class="text-slate-400 font-normal">(3 credits)</span></span>
              </span>
              <span class="text-[11px] text-slate-500 leading-snug">Good OCR capabilities at least amount of quota</span>
            </label>
            <label class="flex-1 flex flex-col gap-0.5 cursor-pointer border rounded-lg px-3 py-2 transition-colors {ocrPro ? 'border-blue-300 bg-blue-50' : 'border-slate-200'}">
              <span class="flex items-center gap-1.5">
                <input type="radio" name="ocrMode" checked={ocrPro} onchange={() => ocrPro = true} class="text-blue-600 focus:ring-blue-500" />
                <span class="text-xs font-medium text-slate-700">OCR Pro <span class="text-slate-400 font-normal">(6 credits)</span></span>
              </span>
              <span class="text-[11px] text-slate-500 leading-snug">Extreme OCR capabilities. Use sparingly for messy, handwritten receipts in low light</span>
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

        <!-- CSV import -->
        <div>
          <button onclick={triggerCsvImport} disabled={csvImporting} class="flex items-center gap-2 text-sm text-slate-600 hover:text-blue-600 transition-colors cursor-pointer disabled:text-slate-300">
            <i class="ph ph-file-csv"></i>
            <span>{csvImporting ? 'Importing...' : 'Import CSV'}</span>
          </button>
          <input bind:this={csvFileInput} type="file" accept=".csv" class="hidden" onchange={handleCsvFileSelect} />
          {#if csvImporting}
            <div class="flex items-center gap-2 text-sm text-slate-500 mt-2">
              <i class="ph ph-circle-notch animate-spin"></i>
              <span>Importing CSV...</span>
            </div>
          {/if}
          {#if csvResult}
            <div class="mt-2 px-3 py-2 rounded-lg text-sm {csvResult.success ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}">
              {#if csvResult.success}
                <i class="ph ph-check-circle mr-1"></i>
              {:else}
                <i class="ph ph-x-circle mr-1"></i>
              {/if}
              {csvResult.message}
              {#if csvResult.success}
                <button onclick={() => { csvResult = null; onclose?.(); }} class="ml-2 text-blue-600 hover:underline">Close</button>
              {:else}
                <button onclick={() => csvResult = null} class="ml-2 text-blue-600 hover:underline">Dismiss</button>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<BulkImportModal
  show={showBulkModal}
  results={parsedReceipts}
  onclose={() => { showBulkModal = false; parsedReceipts = []; }}
  onsave={handleBulkSave}
/>
