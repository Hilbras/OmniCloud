import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { lazy, Suspense, useEffect } from "react";
import type { ReactNode } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { onUnauthorized } from "./api/client";
import DriveLayout from "./components/DriveLayout";
import { InstallPrompt } from "./components/InstallPrompt";
import { NativeServerHint } from "./components/NativeServerHint";
import { NativeServerSetup } from "./components/NativeServerSetup";
import { getServerUrl, isNativeRuntime } from "./lib/api-base";
import { useMe } from "./hooks/useMe";
import { ME_QUERY_KEY, SIGNED_OUT_SESSION } from "./lib/queries";
import { clear as clearCryptoSession } from "./lib/crypto-session";
import { clearNameIndex, forgetLoadedIndex } from "./lib/name-index-session";
import { clearThumbnails } from "./lib/thumbnails";
import { clearPersistedThumbnails } from "./lib/thumbnail-cache";
import { clearOfflineFiles } from "./lib/offline-files";
const DrivePage = lazy(() => import("./pages/DrivePage"));
const LandingPage = lazy(() => import("./pages/LandingPage"));
const DownloadPage = lazy(() => import("./pages/DownloadPage"));
const AboutPage = lazy(() => import("./pages/InfoPages").then((m) => ({ default: m.AboutPage })));
const PrivacyPage = lazy(() =>
  import("./pages/InfoPages").then((m) => ({ default: m.PrivacyPage })),
);
const TermsPage = lazy(() => import("./pages/InfoPages").then((m) => ({ default: m.TermsPage })));
const FaqPage = lazy(() => import("./pages/InfoPages").then((m) => ({ default: m.FaqPage })));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const RecentPage = lazy(() => import("./pages/RecentPage"));
const StarredPage = lazy(() => import("./pages/StarredPage"));
const StoragePage = lazy(() => import("./pages/StoragePage"));
const TokensPage = lazy(() =>
  import("./pages/TokensPage").then((module) => ({ default: module.TokensPage })),
);
const TrashPage = lazy(() => import("./pages/TrashPage"));
const StorageInit = lazy(() => import("./pages/StorageInit"));
const SharePage = lazy(() => import("./pages/SharePage"));
const PairPage = lazy(() => import("./pages/PairPage").then((m) => ({ default: m.PairPage })));

function ShareRoute() {
  const { token } = useParams<{ token: string }>();
  if (!token) return <Navigate to="/" replace />;
  return <SharePage token={token} />;
}

function PairRoute() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <Navigate to="/" replace />;
  return <PairPage id={id} />;
}

function FullPageSpinner() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex h-dvh items-center justify-center bg-bg"
    >
      <Loader2 className="h-7 w-7 animate-spin text-gold" aria-hidden="true" />
    </div>
  );
}

/** Requires a signed-in session, and an initialized storage channel. */
function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isPending) return <FullPageSpinner />;
  if (me.data === undefined || me.data.user === null) return <Navigate to="/login" replace />;
  if (me.data.storage === null) return <StorageInit />;
  return children;
}

export default function App() {
  const queryClient = useQueryClient();

  // Any 401 from any endpoint resets the session so the route guard redirects to /login.
  useEffect(
    () =>
      onUnauthorized(() => {
        clearCryptoSession();
        clearNameIndex();
        forgetLoadedIndex();
        clearThumbnails();
        void clearPersistedThumbnails();
        void clearOfflineFiles();
        queryClient.setQueryData(ME_QUERY_KEY, SIGNED_OUT_SESSION);
        queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "me" });
      }),
    [queryClient],
  );

  if (isNativeRuntime() && getServerUrl() === null) {
    return <NativeServerSetup />;
  }

  return (
    <>
      <Suspense fallback={<FullPageSpinner />}>
        <Routes>
          <Route path="/setup-server" element={<NativeServerSetup />} />
          <Route path="/" element={<LandingPage />} />
          <Route path="/download" element={<DownloadPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/faq" element={<FaqPage />} />
          <Route path="/welcome" element={<Navigate to="/" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/s/:token" element={<ShareRoute />} />
          <Route
            path="/pair/:id"
            element={
              <RequireAuth>
                <PairRoute />
              </RequireAuth>
            }
          />
          <Route
            element={
              <RequireAuth>
                <DriveLayout />
              </RequireAuth>
            }
          >
            <Route path="/drive" element={<DrivePage />} />
            <Route path="/recent" element={<RecentPage />} />
            <Route path="/starred" element={<StarredPage />} />
            <Route path="/trash" element={<TrashPage />} />
            <Route path="/storage" element={<StoragePage />} />
            <Route path="/settings/tokens" element={<TokensPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <InstallPrompt />
      <NativeServerHint />
    </>
  );
}
