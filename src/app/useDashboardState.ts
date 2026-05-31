import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type {
  AppSettings,
  AppSettingsInput,
  ArticleCategory,
  ArticleRecord,
  AuthState,
  Site,
} from "../lib/types";
import type { DashboardSurface } from "../lib/surface";

const DEFAULT_APP_SETTINGS: AppSettings = {
  ai_api_connected: false,
  ai_api_mode: "oilor_default",
  ai_api_provider_label: "Oilor.app free AI API",
  ai_model: "gemini-3.1-flash-preview",
  custom_ai_api_key_saved: false,
  default_ai_api_connected: false,
  gemini_api_connected: false,
  gemini_flash_model: "gemini-3.1-flash-preview",
  gemini_pro_model: "gemini-3.1-flash-preview",
  global_ai_rules: "",
  social_agent_rules: "",
  workspace_timezone: "Asia/Kuala_Lumpur",
  trading_agent_url: "",
  trading_agent_connected: false,
  trading_agent_token_saved: false,
  ctrader_client_id: "",
  ctrader_account_id: "",
  ctrader_demo_account_id: "",
  ctrader_live_account_id: "",
  ctrader_connected: false,
  ctrader_client_secret_saved: false,
  ctrader_access_token_saved: false,
};

type LoginMode = "google" | "fallback";

type UseDashboardStateOptions = {
  loginMode: LoginMode;
  returnTo: string;
  surface: DashboardSurface;
};

export function useDashboardState({ loginMode, returnTo, surface }: UseDashboardStateOptions) {
  const [auth, setAuth] = useState<AuthState>({ authenticated: false });
  const [sites, setSites] = useState<Site[]>([]);
  const [articles, setArticles] = useState<ArticleRecord[]>([]);
  const [categories, setCategories] = useState<ArticleCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.bootstrap();
      setAuth(data.auth);
      setSites(data.sites);
      setArticles(data.articles);
      if (data.auth.authenticated) {
        const loaders = [api.getSettings().then(setAppSettings)];
        if (surface === "articles") {
          loaders.push(api.getCategories().then(setCategories));
        } else {
          setCategories([]);
        }
        void Promise.all(loaders).catch((loadError) => {
          setError(loadError instanceof Error ? loadError.message : "Failed to load dashboard settings");
        });
      }
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [surface]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveSettings = useCallback(async (payload: AppSettingsInput) => {
    const next = await api.updateSettings(payload);
    setAppSettings(next);
    setSettingsMessage(next.sync_result?.message ?? "Settings saved.");
    return next;
  }, []);

  const syncAgentSettings = useCallback(async () => {
    const result = await api.syncTradingAgentSettings();
    setSettingsMessage(result.message);
  }, []);

  const handlePasswordLogin = useCallback(async (username: string, password: string, remember: boolean) => {
    const nextAuth = await api.login(username, password, remember);
    if (returnTo && typeof window !== "undefined") {
      window.location.href = returnTo;
      return;
    }
    if (loginMode === "fallback" && typeof window !== "undefined") {
      window.history.replaceState(window.history.state, "", "/dashboard");
    }
    setAuth(nextAuth);
    await load();
  }, [load, loginMode, returnTo]);

  const handleLogout = useCallback(async () => {
    await api.logout();
    setAuth({ authenticated: false });
    setSites([]);
    setArticles([]);
    setCategories([]);
    setError(null);
  }, []);

  return {
    auth,
    sites,
    articles,
    categories,
    loading,
    error,
    appSettings,
    settingsMessage,
    load,
    saveSettings,
    syncAgentSettings,
    handlePasswordLogin,
    handleLogout,
  };
}
