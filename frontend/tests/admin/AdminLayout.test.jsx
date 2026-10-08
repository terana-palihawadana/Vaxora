import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import AdminLayout from "../../src/features/admin/pages/AdminLayout";
import { authService } from "../../src/features/auth";

vi.mock("../../src/features/auth", () => ({
  authService: {
    getPendingVerifications: vi.fn(),
    getAuditLogs: vi.fn(),
  },
}));

// Stub the sidebar to isolate the layout shell logic
vi.mock("../../src/features/admin/components/AdminSidebar", () => ({
  default: () => <div data-testid="admin-sidebar">Sidebar</div>,
}));

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route
            path=":tab"
            element={<div data-testid="outlet-content">Outlet</div>}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

describe("AdminLayout - React admin portal shell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authService.getPendingVerifications.mockResolvedValue([]);
  });

  it("renders the sidebar and the outlet content", () => {
    renderAt("/admin/feedback");
    expect(screen.getByTestId("admin-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("outlet-content")).toBeInTheDocument();
  });

  it('shows "Feedback & Inquiries Central" for /admin/feedback', () => {
    renderAt("/admin/feedback");
    expect(
      screen.getAllByText(/Feedback & Inquiries Central/i).length,
    ).toBeGreaterThan(0);
  });

  it('shows "National User Directory" for /admin/users', () => {
    renderAt("/admin/users");
    expect(
      screen.getAllByText(/National User Directory/i).length,
    ).toBeGreaterThan(0);
  });

  it('shows "System Audit & Compliance Logs" for /admin/audit', () => {
    renderAt("/admin/audit");
    expect(
      screen.getAllByText(/System Audit & Compliance Logs/i).length,
    ).toBeGreaterThan(0);
  });

  it("falls back to the Executive Operations Dashboard title for unmapped paths", () => {
    renderAt("/admin/unknown");
    expect(
      screen.getAllByText(/Executive Operations Dashboard/i).length,
    ).toBeGreaterThan(0);
  });

  it("fetches the pending verifications count on mount", async () => {
    authService.getPendingVerifications.mockResolvedValue([
      { status: "Pending" },
      { status: "Pending" },
    ]);

    renderAt("/admin/approvals");

    await waitFor(() => {
      expect(authService.getPendingVerifications).toHaveBeenCalled();
    });
  });

  it("renders the fixed admin footer", () => {
    renderAt("/admin/audit");
    expect(
      screen.getByText(/Vaxora National Immunization Network/i),
    ).toBeInTheDocument();
  });
});
