import { useSession } from "./hooks/useSession";
import { LoginForm } from "./components/loginForm";
import { Portal } from "./components/Portal";

export default function App() {
  const { session, loading } = useSession();
  if (loading) return null;
  return session ? <Portal email={session.user.email ?? ''} /> : <div className="center"><LoginForm/></div>;
}