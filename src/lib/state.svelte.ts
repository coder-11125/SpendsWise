import { API_BASE, POLL_INTERVAL_MS, defaultExpenseCategories, defaultIncomeCategories } from './constants.js';
import type { Expense, CurrencyRates, CategoryData, Space, WeeklySummary } from '../types.js';

let _csrfToken = $state<string | null>(null);
let _isLoggedIn = $state<boolean>(false);
let _authChecking = $state<boolean>(true);
let _userId = $state<string | null>(null);
let _expense = $state<Expense[]>([]);
let _currentCurrency = $state<string>(localStorage.getItem('sw_currency') || 'USD');
let _spaces = $state<Space[]>([]);
let _currentSpaceId = $state<string | null>(null);
let _pendingInvites = $state<Space[]>([]);
let _currentFilter = $state<string>('all');
let _expenseTrendRange = $state<string>('month');
let _incomeTrendRange = $state<string>('month');
let _budgetGoals = $state<Record<string, number>>(JSON.parse(localStorage.getItem('sw_budget_goals') || '{}'));
let _currencyRates = $state<CurrencyRates>(JSON.parse(localStorage.getItem('sw_currency_rates') || '{}'));
let _lastRateFetch = $state<number>(parseInt(localStorage.getItem('sw_last_rate_fetch') || '0', 10));
let _rateLimitHit = $state<boolean>(localStorage.getItem('sw_rate_limit_hit') === 'true');
let _rateLimitHitTime = $state<number>(parseInt(localStorage.getItem('sw_rate_limit_hit_time') || '0', 10));
// C12: whether the currently cached currency rates came from the real
// exchangerate-api response vs. the server's 1:1 fallback. Starts true
// (optimistic) so no warning flashes before the first rate fetch resolves.
let _ratesAreLive = $state<boolean>(true);
export interface AiChatMessage { role: string; content: string }
export interface AiChat {
  id: string;
  title: string;
  messages: AiChatMessage[];
  updatedAt: number;
  // Which ledger this conversation is pinned to: a Hub id, null for Personal,
  // or undefined for legacy chats that follow the app's current selection.
  spaceId?: string | null;
}

function loadAiChats(): AiChat[] {
  try {
    return JSON.parse(localStorage.getItem('sw_ai_chats') || '[]');
  } catch {
    return [];
  }
}

function persistAiChats(): void {
  try {
    localStorage.setItem('sw_ai_chats', JSON.stringify(_aiChats));
  } catch (e) {
    console.warn('Could not save AI chats to localStorage:', e);
  }
}

function makeDraftChat(): AiChat {
  return { id: crypto.randomUUID(), title: 'New chat', messages: [], updatedAt: Date.now() };
}

let _aiChats = $state<AiChat[]>(loadAiChats());
let _activeAiChat = $state<AiChat>(makeDraftChat());
let _activeAiChatSaved = $state<boolean>(false);
let _email = $state<string>(localStorage.getItem('sw_email') || '');
let _expenseChartData = $state<CategoryData[]>([]);
let _expenseChartTotal = $state<number>(0);
let _rateFetchAttempts: Record<string, number> = {};

function loadCustomCategories(): { expense: string[]; income: string[] } {
  try {
    const parsed = JSON.parse(localStorage.getItem('sw_custom_categories') || '{}');
    return {
      expense: Array.isArray(parsed.expense) ? parsed.expense : [],
      income: Array.isArray(parsed.income) ? parsed.income : [],
    };
  } catch {
    return { expense: [], income: [] };
  }
}

let _customCategories = $state<{ expense: string[]; income: string[] }>(loadCustomCategories());

function loadHiddenCategories(): { expense: string[]; income: string[] } {
  try {
    const parsed = JSON.parse(localStorage.getItem('sw_hidden_categories') || '{}');
    return {
      expense: Array.isArray(parsed.expense) ? parsed.expense : [],
      income: Array.isArray(parsed.income) ? parsed.income : [],
    };
  } catch {
    return { expense: [], income: [] };
  }
}

let _hiddenCategories = $state<{ expense: string[]; income: string[] }>(loadHiddenCategories());

export function getCustomCategories(type: string): string[] {
  return type === 'income' ? _customCategories.income : _customCategories.expense;
}

export function getHiddenCategories(type: string): string[] {
  return type === 'income' ? _hiddenCategories.income : _hiddenCategories.expense;
}

export function hideCategory(type: string, name: string): void {
  const key = type === 'income' ? 'income' : 'expense';
  if (_hiddenCategories[key].includes(name)) return;
  _hiddenCategories = { ..._hiddenCategories, [key]: [..._hiddenCategories[key], name] };
  try {
    localStorage.setItem('sw_hidden_categories', JSON.stringify(_hiddenCategories));
  } catch (e) {
    console.warn('Could not save hidden categories to localStorage:', e);
  }
}

export function unhideCategory(type: string, name: string): void {
  const key = type === 'income' ? 'income' : 'expense';
  _hiddenCategories = { ..._hiddenCategories, [key]: _hiddenCategories[key].filter(c => c !== name) };
  try {
    localStorage.setItem('sw_hidden_categories', JSON.stringify(_hiddenCategories));
  } catch (e) {
    console.warn('Could not save hidden categories to localStorage:', e);
  }
}

export function getAllCategories(type: string): string[] {
  const defaults = type === 'income' ? defaultIncomeCategories : defaultExpenseCategories;
  const hidden = getHiddenCategories(type);
  const visibleDefaults = defaults.filter(c => !hidden.includes(c));
  return [...visibleDefaults, ...getCustomCategories(type)];
}

export function addCustomCategory(type: string, name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  const existing = getAllCategories(type);
  const match = existing.find(c => c.toLowerCase() === trimmed.toLowerCase());
  if (match) return match;
  const key = type === 'income' ? 'income' : 'expense';
  _customCategories = { ..._customCategories, [key]: [..._customCategories[key], trimmed] };
  try {
    localStorage.setItem('sw_custom_categories', JSON.stringify(_customCategories));
  } catch (e) {
    console.warn('Could not save custom categories to localStorage:', e);
  }
  return trimmed;
}

export function removeCustomCategory(type: string, name: string): void {
  const key = type === 'income' ? 'income' : 'expense';
  _customCategories = { ..._customCategories, [key]: _customCategories[key].filter(c => c !== name) };
  try {
    localStorage.setItem('sw_custom_categories', JSON.stringify(_customCategories));
  } catch (e) {
    console.warn('Could not save custom categories to localStorage:', e);
  }
}

let _currentView = $state<string>('landing');
let _viewMode = $state<'overview' | 'list'>('overview');
let _pollInterval: any = null;
let _pusher: any = null;

export interface ConfirmRequest { message: string; resolve: (v: boolean) => void }
let _confirmRequest = $state<ConfirmRequest | null>(null);

export function getConfirmRequest() { return _confirmRequest; }

export function confirmDialog(message: string): Promise<boolean> {
  return new Promise(resolve => {
    _confirmRequest = { message, resolve: (v: boolean) => { _confirmRequest = null; resolve(v); } };
  });
}

export function getCsrfToken() { return _csrfToken; }
export function setCsrfToken(v: string | null) { _csrfToken = v; }

export function getIsLoggedIn() { return _isLoggedIn; }
export function setIsLoggedIn(v: boolean) { _isLoggedIn = v; }

export function getAuthChecking() { return _authChecking; }
export function setAuthChecking(v: boolean) { _authChecking = v; }

export function getUserId() { return _userId; }
export function setUserId(v: string | null) { _userId = v; }

export function getExpense() { return _expense; }
export function setExpense(v: Expense[]) { _expense = v; }
export function addExpenseItem(item: Expense) { _expense = [item, ..._expense]; }
export function removeExpenseItem(id: string) { _expense = _expense.filter(e => e.id !== id); }
export function updateExpenseItem(updated: Expense) {
  _expense = _expense.map(e => e.id === updated.id ? updated : e);
}

export function getCurrentCurrency() { return _currentCurrency; }
export function setCurrentCurrency(v: string) {
  _currentCurrency = v;
  localStorage.setItem('sw_currency', v);
}

export function getSpaces() { return _spaces; }
export function setSpaces(v: Space[]) { _spaces = Array.isArray(v) ? [...v] : []; }

export function getPendingInvites() { return _pendingInvites; }
export function setPendingInvites(v: Space[]) { _pendingInvites = Array.isArray(v) ? [...v] : []; }

// Newest weekly summary, surfaced in the Header notifications until viewed.
// "Seen" is remembered per account on this device.
let _latestSummary = $state<WeeklySummary | null>(null);
let _seenSummaryWeek = $state<string>('');

function seenSummaryKey() { return `sw_seen_summary_week:${_email}`; }

export function getLatestSummary() { return _latestSummary; }
export function setLatestSummary(v: WeeklySummary | null) {
  _latestSummary = v;
  try { _seenSummaryWeek = localStorage.getItem(seenSummaryKey()) || ''; } catch { _seenSummaryWeek = ''; }
}
export function hasUnseenSummary() {
  return !!_latestSummary && _latestSummary.weekStartDate > _seenSummaryWeek;
}
export function markSummarySeen() {
  if (!_latestSummary) return;
  _seenSummaryWeek = _latestSummary.weekStartDate;
  try { localStorage.setItem(seenSummaryKey(), _seenSummaryWeek); } catch { /* storage unavailable */ }
}

export function getCurrentSpaceId() { return _currentSpaceId; }
export function setCurrentSpaceId(v: string | null) { _currentSpaceId = v; }

export function getCurrentSpace(): Space | null {
  if (!_currentSpaceId) return null;
  return _spaces.find(s => s.id === _currentSpaceId) ?? null;
}

export function getCurrentFilter() { return _currentFilter; }
export function setCurrentFilter(v: string) { _currentFilter = v; }

export function getExpenseTrendRange() { return _expenseTrendRange; }
export function setExpenseTrendRange(v: string) { _expenseTrendRange = v; }

export function getIncomeTrendRange() { return _incomeTrendRange; }
export function setIncomeTrendRange(v: string) { _incomeTrendRange = v; }

export function getBudgetGoals() { return _budgetGoals; }
export function setBudgetGoals(v: Record<string, number>) {
  _budgetGoals = v;
  localStorage.setItem('sw_budget_goals', JSON.stringify(v));
}

export function getCurrencyRates() { return _currencyRates; }
export function setCurrencyRates(v: CurrencyRates) {
  _currencyRates = v;
  persistCurrencyState();
}

export function getLastRateFetch() { return _lastRateFetch; }
export function setLastRateFetch(v: number) { _lastRateFetch = v; }

export function getRateLimitHit() { return _rateLimitHit; }
export function setRateLimitHit(v: boolean) { _rateLimitHit = v; }

export function getRateLimitHitTime() { return _rateLimitHitTime; }
export function setRateLimitHitTime(v: number) { _rateLimitHitTime = v; }

export function getRatesAreLive() { return _ratesAreLive; }
export function setRatesAreLive(v: boolean) { _ratesAreLive = v; }

export function getAiChats() { return _aiChats; }

export function getActiveAiChat() { return _activeAiChat; }

export function startNewAiChat(): void {
  _activeAiChat = makeDraftChat();
  _activeAiChatSaved = false;
}

export function selectAiChat(id: string): void {
  const chat = _aiChats.find(c => c.id === id);
  if (!chat) return;
  _activeAiChat = chat;
  _activeAiChatSaved = true;
}

export function deleteAiChat(id: string): void {
  _aiChats = _aiChats.filter(c => c.id !== id);
  persistAiChats();
  // If the deleted conversation was the one being viewed, reset to a fresh
  // draft so the panel never shows messages from a chat that no longer exists.
  if (_activeAiChat.id === id) {
    _activeAiChat = makeDraftChat();
    _activeAiChatSaved = false;
  }
}

export function setActiveAiChatMessages(messages: AiChatMessage[]): void {
  _activeAiChat = { ..._activeAiChat, messages, updatedAt: Date.now() };
  if (!_activeAiChatSaved) {
    const firstUser = messages.find(m => m.role === 'user');
    if (!firstUser) return;
    _activeAiChat.title = firstUser.content.slice(0, 40) || 'New chat';
    _aiChats = [_activeAiChat, ..._aiChats];
    _activeAiChatSaved = true;
  } else {
    _aiChats = _aiChats.map(c => c.id === _activeAiChat.id ? _activeAiChat : c);
  }
  persistAiChats();
}

// Pin the active conversation to a specific ledger (a Hub id, or null for
// Personal). This is independent of the app's current Hub selection —
// each chat remembers which ledger it is talking about.
export function setActiveAiChatSpaceId(spaceId: string | null): void {
  _activeAiChat = { ..._activeAiChat, spaceId };
  if (_activeAiChatSaved) {
    _aiChats = _aiChats.map(c => c.id === _activeAiChat.id ? _activeAiChat : c);
  }
  persistAiChats();
}

export function getEmail() { return _email; }
export function setEmail(v: string) {
  _email = v;
  localStorage.setItem('sw_email', v);
}

export function getExpenseChartData() { return _expenseChartData; }
export function setExpenseChartData(d: CategoryData[], t: number) { _expenseChartData = d; _expenseChartTotal = t; }
export function getExpenseChartTotal() { return _expenseChartTotal; }

export function getRateFetchAttempts() { return _rateFetchAttempts; }

function persistCurrencyState() {
  try {
    localStorage.setItem('sw_currency_rates', JSON.stringify(_currencyRates));
    localStorage.setItem('sw_last_rate_fetch', _lastRateFetch.toString());
    localStorage.setItem('sw_rate_limit_hit', _rateLimitHit.toString());
    localStorage.setItem('sw_rate_limit_hit_time', _rateLimitHitTime.toString());
  } catch (e) {
    console.warn('Could not save currency rates to localStorage:', e);
  }
}

setInterval(persistCurrencyState, 30000);

let _spaceChannelName: string | null = null;

export function initPusher(userId: string): void {
  destroyPusher();
  const key = import.meta.env.VITE_PUSHER_KEY;
  const cluster = import.meta.env.VITE_PUSHER_CLUSTER || 'ap1';
  if (!key) return;
  import('pusher-js').then(({ default: Pusher }) => {
    _pusher = new Pusher(key, { cluster });
    const channel = _pusher.subscribe(`user-${userId}`);
    channel.bind('data-changed', () => {
      import('./api.js').then(m => {
        m.loadExpenses();
        m.fetchPendingInvites();
        m.fetchSpaces();
      });
    });
    if (_spaceChannelName) subscribeSpaceChannel(_spaceChannelName.replace(/^space-/, ''));
  });
}

export function subscribeSpaceChannel(spaceId: string): void {
  unsubscribeSpaceChannel();
  _spaceChannelName = `space-${spaceId}`;
  if (!_pusher) return;
  const channel = _pusher.subscribe(_spaceChannelName);
  channel.bind('data-changed', () => {
    import('./api.js').then(m => m.loadExpenses());
  });
}

export function unsubscribeSpaceChannel(): void {
  if (_pusher && _spaceChannelName) {
    _pusher.unsubscribe(_spaceChannelName);
  }
  _spaceChannelName = null;
}

function destroyPusher(): void {
  if (_pusher) {
    _pusher.disconnect();
    _pusher = null;
  }
}

export function startPolling() {
  stopPolling();
  _pollInterval = setInterval(() => {
    if (document.visibilityState === 'visible') {
      import('./api.js').then(m => m.loadExpenses());
    }
  }, POLL_INTERVAL_MS);
}

export function stopPolling() {
  destroyPusher();
  if (_pollInterval) {
    clearInterval(_pollInterval);
    _pollInterval = null;
  }
}

// The authenticated app lives under /dashboard/<view>; "/" is the public
// landing page and "/login" the auth screen. The "expense" and "income" views
// carry an optional third segment selecting their display mode:
// /dashboard/expense (overview, default) or /dashboard/expense/list.
// Pre-/dashboard links (/expense, /income/list, ...) are rewritten in place.
const APP_VIEWS = ['expense', 'income', 'account', 'ai', 'summaries', 'spaces'];

type ParsedRoute = { view: string; mode: 'overview' | 'list'; path: string };

export function isAppView(view: string): boolean {
  return APP_VIEWS.includes(view);
}

/** Canonical URL for an app view, e.g. dashboardPath('income', 'list') → /dashboard/income/list. */
export function dashboardPath(view: string = 'expense', mode: 'overview' | 'list' = 'overview'): string {
  const v = isAppView(view) ? view : 'expense';
  const hasModes = v === 'expense' || v === 'income';
  return `/dashboard/${v}${hasModes && mode === 'list' ? '/list' : ''}`;
}

export function parsePath(path: string): ParsedRoute {
  const segments = path.split('?')[0].split('/').filter(Boolean);
  const [first, ...rest] = segments;

  if (!first) return { view: 'landing', mode: 'overview', path: '/' };
  if (first === 'login') return { view: 'login', mode: 'overview', path: '/login' };

  // /dashboard/<view>/<mode>, or a legacy /<view>/<mode> link.
  const appSegments = first === 'dashboard' ? rest : isAppView(first) ? segments : null;
  if (!appSegments) return { view: 'landing', mode: 'overview', path: '/' };

  const view = isAppView(appSegments[0]) ? appSegments[0] : 'expense';
  const mode = (view === 'expense' || view === 'income') && appSegments[1] === 'list' ? 'list' : 'overview';
  return { view, mode, path: dashboardPath(view, mode) };
}

// Public pages are open to everyone; app views require a session, and a
// signed-in user hitting /login is sent on to the dashboard.
function guard(route: ParsedRoute): ParsedRoute {
  if (!_isLoggedIn && isAppView(route.view)) return { view: 'login', mode: 'overview', path: '/login' };
  if (_isLoggedIn && route.view === 'login') return { view: 'expense', mode: 'overview', path: dashboardPath() };
  return route;
}

function applyRoute(route: ParsedRoute) {
  _currentView = route.view;
  _viewMode = route.mode;
}

function currentLocation(): string {
  return window.location.pathname.replace(/\/+$/, '') || '/';
}

export function initRouter() {
  // Auth isn't known yet here, so only canonicalize the URL; App.svelte runs
  // navigate() once checkSession() settles to apply the auth guard.
  const route = parsePath(currentLocation());
  if (route.path !== currentLocation()) history.replaceState({}, '', route.path);
  applyRoute(route);
  window.addEventListener('popstate', () => {
    const route = guard(parsePath(currentLocation()));
    if (route.path !== currentLocation()) history.replaceState({}, '', route.path);
    applyRoute(route);
  });
}

export function navigate(path: string, { replace = false }: { replace?: boolean } = {}) {
  const route = guard(parsePath(path));
  if (route.path !== currentLocation()) {
    if (replace) history.replaceState({}, '', route.path);
    else history.pushState({}, '', route.path);
  }
  applyRoute(route);
}

export function getCurrentView() {
  return _currentView;
}

export function getViewMode() {
  return _viewMode;
}
