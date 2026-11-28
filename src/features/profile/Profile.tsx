import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  buttonClass,
  Card,
  Field,
  PageHeader,
  SectionTitle,
  PasswordInput,
} from "../../components/ui";
import { useAuth, useMe } from "../../app/auth";
import { useConfig, useErrorText, useText } from "../../app/config";
import { useToast } from "../../app/toast";
import { changePassword } from "../../lib/api";
import { saveTheme, savedTheme, type Theme } from "../../lib/theme";

export function PasswordForm({ onDone }: { onDone?: () => void }) {
  const t = useText();
  const errorText = useErrorText();
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) return setProblem(t("profile.password_short"));
    if (password !== repeat) return setProblem(t("profile.password_mismatch"));
    setProblem(undefined);
    setBusy(true);
    try {
      await changePassword(password);
      setPassword("");
      setRepeat("");
      toast(t("profile.password_saved"));
      onDone?.();
    } catch (error) {
      toast(errorText(error), true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field label={t("profile.new_password")}>
        {(id, className) => (
          <PasswordInput
            id={id}
            autoComplete="new-password"
            className={`${className} h-11`}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        )}
      </Field>
      <Field label={t("profile.repeat_password")} error={problem}>
        {(id, className) => (
          <PasswordInput
            id={id}
            autoComplete="new-password"
            className={`${className} h-11`}
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
          />
        )}
      </Field>
      <Button type="submit" variant="secondary" loading={busy}>
        {t("profile.save_password")}
      </Button>
    </form>
  );
}

export function Profile() {
  const me = useMe();
  const { signOut } = useAuth();
  const { settings } = useConfig();
  const t = useText();
  const [theme, setTheme] = useState<Theme>(savedTheme);

  return (
    <>
      <PageHeader title={t("profile.title")} />
      <Card>
        <p className="text-lg font-semibold">
          {me.first_name} {me.last_name}
        </p>
        <p className="text-muted">{me.login}</p>
        <div className="mt-2">
          <Badge tone="brand">{t(`role.${me.role}`)}</Badge>
        </div>
      </Card>

      <SectionTitle>{t("profile.theme")}</SectionTitle>
      <div className="flex gap-2">
        {(["system", "light", "dark"] as const).map((option) => (
          <Button
            key={option}
            size="sm"
            variant={theme === option ? "primary" : "secondary"}
            aria-pressed={theme === option}
            onClick={() => {
              setTheme(option);
              saveTheme(option);
            }}
          >
            {t(`profile.theme_${option}`)}
          </Button>
        ))}
      </div>

      <SectionTitle>{t("profile.password")}</SectionTitle>
      {me.role === "manager" ? (
        <Card>
          <p className="text-muted">Only the developer can change this password.</p>
        </Card>
      ) : (
        <Card>
          <PasswordForm />
        </Card>
      )}

      {(settings.center_phone || settings.center_address) && (
        <>
          <SectionTitle>{t("profile.help")}</SectionTitle>
          <Card>
            {settings.center_phone && (
              <a
                href={`tel:${settings.center_phone}`}
                className="block font-medium text-brand-ink"
              >
                {settings.center_phone}
              </a>
            )}
            {settings.center_address && (
              <p className="text-muted">{settings.center_address}</p>
            )}
          </Card>
        </>
      )}

      <Link
        to="/rules"
        className={buttonClass("secondary", "md", true) + " mt-6"}
      >
        {t("profile.rules")}
      </Link>
      {me.leaderboard_enabled && (
        <Link
          to="/top"
          className={buttonClass("secondary", "md", true) + " mt-3"}
        >
          {t("nav.top")}
        </Link>
      )}
      <Button variant="danger" block className="mt-3" onClick={signOut}>
        {t("profile.logout")}
      </Button>
    </>
  );
}
