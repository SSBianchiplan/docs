import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Skeleton } from "./components/ui";
import { Login } from "./pages/Login";
import { ForcedPasswordChange } from "./pages/ChangePassword";
import { useSession } from "./store/session";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Documents = lazy(() => import("./pages/Documents"));
const DocumentDetail = lazy(() => import("./pages/DocumentDetail"));
const Tasks = lazy(() => import("./pages/Tasks"));
const Grds = lazy(() => import("./pages/Grds"));
const GrdDetail = lazy(() => import("./pages/GrdDetail"));
const SearchPage = lazy(() => import("./pages/Search"));
const Suggestions = lazy(() => import("./pages/Suggestions"));
const Audit = lazy(() => import("./pages/Audit"));
const Projects = lazy(() => import("./pages/Projects"));
const Users = lazy(() => import("./pages/Users"));
const ProjectWizard = lazy(() => import("./pages/ProjectWizard"));
const ProjectDetail = lazy(() => import("./pages/ProjectDetail"));
const Landing = lazy(() => import("./pages/Landing"));
const Drawings = lazy(() => import("./pages/Drawings"));
const Writer = lazy(() => import("./pages/Writer"));
const Sheets = lazy(() => import("./pages/Sheets"));
const Sso = lazy(() => import("./pages/Sso"));
const Settings = lazy(() => import("./pages/Settings"));

const Loading = <div className="p-6 space-y-3"><Skeleton className="h-8 w-64" /><Skeleton className="h-64" /></div>;

export function App() {
  const { token, mustChange, user } = useSession();
  if (!token) return (
    <Suspense fallback={Loading}>
      <Routes>
        <Route index element={<Landing />} />
        <Route path="entrar" element={<Login />} />
        <Route path="sso" element={<Sso />} />
        <Route path="*" element={<Navigate to="/entrar" replace />} />
      </Routes>
    </Suspense>
  );
  if (mustChange) return <ForcedPasswordChange />;
  return (
    <Suspense fallback={Loading}>
      <Routes>
        <Route path="entrar" element={<Navigate to="/" replace />} />
        <Route path="inicio" element={<Landing />} />
        <Route path="sso" element={<Sso />} />
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="documentos" element={<Documents />} />
          <Route path="documentos/:id" element={<DocumentDetail />} />
          <Route path="drawings" element={<Drawings />} />
          <Route path="writer" element={<Writer />} />
          <Route path="sheets" element={<Sheets />} />
          <Route path="configuracoes" element={<Settings />} />
          <Route path="pendencias" element={<Tasks />} />
          <Route path="grd" element={<Grds />} />
          <Route path="grd/:id" element={<GrdDetail />} />
          <Route path="busca" element={<SearchPage />} />
          <Route path="ia" element={<Suggestions />} />
          <Route path="projetos" element={<Projects />} />
          <Route path="projetos/novo" element={<ProjectWizard />} />
          <Route path="projetos/:id" element={<ProjectDetail />} />
          <Route path="auditoria" element={<Audit />} />
          {user?.is_admin && <Route path="usuarios" element={<Users />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
