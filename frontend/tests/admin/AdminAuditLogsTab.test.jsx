import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AdminAuditLogsTab from "../../src/features/admin/components/AdminAuditLogsTab";
import { authService } from "../../src/features/auth";

vi.mock("../../src/features/auth", () => ({
  authService: {
    getAuditLogs: vi.fn(),
    getPendingVerifications: vi.fn(),
  },
}));

const sampleLogs = [
  {
    id: "aabbccdd-1111-2222-3333-444444444444",
    timestamp: "2026-10-05T10:00:00Z",
    userEmail: "admin@vaxora.lk",
    role: "ADMIN",
    action: "VERIFICATION_APPROVED",
    details: "Doctor approved",
  },
  {
    id: "bbccddee-2222-3333-4444-555555555555",
    timestamp: "2026-10-05T11:00:00Z",
    userEmail: "user@vaxora.lk",
    role: "PATIENT",
    action: "LOGIN_SUCCESS",
    details: "Successful login",
  },
  {
    id: "ccddeeff-3333-4444-5555-666666666666",
    timestamp: "2026-10-05T12:00:00Z",
    userEmail: "admin@vaxora.lk",
    role: "ADMIN",
    action: "VERIFICATION_REJECTED",
    details: "Bad SLMC",
  },
];

describe("AdminAuditLogsTab - React admin audit log viewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Loading state
  it("shows loading indicator while audit logs are being fetched", async () => {
    let resolveGet;
    authService.getAuditLogs.mockReturnValue(
      new Promise((r) => {
        resolveGet = r;
      }),
    );
    render(<AdminAuditLogsTab />);
    expect(screen.getByText(/Loading live audit records/i)).toBeInTheDocument();
    resolveGet([]);
  });

  // 2. Successful load
  it("renders audit log rows after load", async () => {
    authService.getAuditLogs.mockResolvedValue(sampleLogs);
    render(<AdminAuditLogsTab />);

    expect(await screen.findByText("Doctor approved")).toBeInTheDocument();
    expect(screen.getByText("Successful login")).toBeInTheDocument();
    expect(screen.getByText(/Displaying 3 verified/i)).toBeInTheDocument();
  });

  // 3. Error state
  it("shows an error banner when the audit log API fails", async () => {
    authService.getAuditLogs.mockRejectedValue(
      new Error("Audit service unavailable"),
    );
    render(<AdminAuditLogsTab />);

    expect(
      await screen.findByText(/Audit service unavailable/i),
    ).toBeInTheDocument();
  });

  // 4. Empty state
  it("renders the empty state when there are no audit records", async () => {
    authService.getAuditLogs.mockResolvedValue([]);
    render(<AdminAuditLogsTab />);

    expect(
      await screen.findByText(/No audit records match your search filters/i),
    ).toBeInTheDocument();
  });

  // 5. Category classification — VERIFICATION_* → USER_VERIFICATION
  it("classifies VERIFICATION_APPROVED as USER_VERIFICATION", async () => {
    const { container } = render(<AdminAuditLogsTab />);
    authService.getAuditLogs.mockResolvedValue([sampleLogs[0]]);

    // Re-render to pick up the mock (initial useEffect ran with no mock)
    const second = render(<AdminAuditLogsTab />);
    await screen.findByText("Doctor approved");

    const badges = Array.from(
      second.container.querySelectorAll(".doctor-table .admin-pill-badge"),
    ).map((el) => el.textContent.trim());
    expect(badges).toContain("USER VERIFICATION");
    container.remove();
  });

  // 6. Category classification — LOGIN_SUCCESS → SECURITY_AUTH
  it("classifies LOGIN_SUCCESS as SECURITY_AUTH", async () => {
    authService.getAuditLogs.mockResolvedValue([sampleLogs[1]]);
    const { container } = render(<AdminAuditLogsTab />);
    await screen.findByText("Successful login");

    const badges = Array.from(
      container.querySelectorAll(".doctor-table .admin-pill-badge"),
    ).map((el) => el.textContent.trim());
    expect(badges).toContain("SECURITY AUTH");
  });

  // 7. Severity classification — REJECT → CRITICAL
  it("classifies REJECTED actions as CRITICAL severity", async () => {
    authService.getAuditLogs.mockResolvedValue([sampleLogs[2]]);
    const { container } = render(<AdminAuditLogsTab />);
    await screen.findByText("Bad SLMC");

    expect(container.textContent).toContain("Critical Action");
  });

  // 8. Search filter
  it("filters the visible log list by search query", async () => {
    authService.getAuditLogs.mockResolvedValue(sampleLogs);
    render(<AdminAuditLogsTab />);
    await screen.findByText("Doctor approved");

    const search = screen.getByPlaceholderText(/Search by log ID/i);
    fireEvent.change(search, { target: { value: "login" } });

    expect(screen.getByText("Successful login")).toBeInTheDocument();
    expect(screen.queryByText("Doctor approved")).not.toBeInTheDocument();
  });

  // 9. Category pill filter
  it("filters the log list by the SECURITY AUTH category pill", async () => {
    authService.getAuditLogs.mockResolvedValue(sampleLogs);
    render(<AdminAuditLogsTab />);
    await screen.findByText("Doctor approved");

    fireEvent.click(screen.getByRole("button", { name: /SECURITY AUTH/i }));

    expect(screen.getByText("Successful login")).toBeInTheDocument();
    expect(screen.queryByText("Doctor approved")).not.toBeInTheDocument();
  });

  // 10. Pause / Resume toggle
  it("toggles the live stream between paused and live states", async () => {
    authService.getAuditLogs.mockResolvedValue(sampleLogs);
    render(<AdminAuditLogsTab />);
    await screen.findByText("Doctor approved");

    expect(screen.getByText(/Live Polling \(5s\)/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Pause Stream/i }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Pause Stream/i }));

    // After pause, the button flips to Resume
    expect(
      screen.getByRole("button", { name: /Resume Stream/i }),
    ).toBeInTheDocument();
    // "Stream Paused" appears in the toast, badge and subtitle — assert at least one
    expect(screen.getAllByText(/Stream Paused/i).length).toBeGreaterThan(0);
  });

  // 11. Inspect modal
  it("opens the inspect modal with the full audit event details", async () => {
    authService.getAuditLogs.mockResolvedValue([sampleLogs[0]]);
    render(<AdminAuditLogsTab />);
    await screen.findByText("Doctor approved");

    fireEvent.click(screen.getByRole("button", { name: /Inspect/i }));

    expect(screen.getByText(/Audit Record:/i)).toBeInTheDocument();
    expect(screen.getByText(/Event Details/i)).toBeInTheDocument();
  });

  // 12. CSV export shows toast when there is nothing to export
  it("shows a toast when CSV export is triggered with no data", async () => {
    authService.getAuditLogs.mockResolvedValue([]);
    render(<AdminAuditLogsTab />);

    await waitFor(() => {
      expect(
        screen.getByText(/No audit records match your search filters/i),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Export Audit Report/i }),
    );

    expect(
      screen.getByText(/No audit records available to export/i),
    ).toBeInTheDocument();
  });
});
