import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AdminFeedbackTab from "../../src/features/admin/components/AdminFeedbackTab";
import { feedbackService } from "../../src/shared/services/feedbackService";

vi.mock("../../src/shared/services/feedbackService", () => ({
  feedbackService: {
    getAll: vi.fn(),
    resolve: vi.fn(),
  },
}));

const sampleFeedback = [
  {
    id: "fb-11111111-aaaa",
    isAnonymous: false,
    submitterName: "John Doe",
    submitterEmail: "john@example.com",
    submitterPhone: "0771234567",
    userRole: "PATIENT",
    hospitalName: "National Hospital Colombo",
    category: "Vaccination Service",
    subject: "Great service",
    message: "Quick and professional.",
    rating: 5,
    status: "New",
    createdAt: "2026-10-01T10:30:00Z",
    adminResponse: null,
    repliedAt: null,
  },
  {
    id: "fb-22222222-bbbb",
    isAnonymous: true,
    submitterName: null,
    submitterEmail: null,
    submitterPhone: null,
    userRole: "PATIENT",
    hospitalName: null,
    category: "System / Bug",
    subject: "App crashed",
    message: "Freezes when booking.",
    rating: 2,
    status: "Resolved",
    createdAt: "2026-10-02T11:00:00Z",
    adminResponse: "We fixed it in the latest release.",
    repliedAt: "2026-10-03T09:00:00Z",
  },
];

describe("AdminFeedbackTab - React admin portal feedback inbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Loading state
  it("shows loading state on mount before the API resolves", async () => {
    let resolveGet;
    feedbackService.getAll.mockReturnValue(
      new Promise((r) => {
        resolveGet = r;
      }),
    );
    render(<AdminFeedbackTab />);
    expect(screen.getByText(/Loading feedback/i)).toBeInTheDocument();
    resolveGet([]);
  });

  // 2. Successful load
  it("renders the feedback table with submission data after load", async () => {
    feedbackService.getAll.mockResolvedValue(sampleFeedback);
    render(<AdminFeedbackTab />);

    expect(await screen.findByText("John Doe")).toBeInTheDocument();
    expect(screen.getByText("Great service")).toBeInTheDocument();
    expect(
      screen.getByText(/Showing 2 of 2 total submissions/i),
    ).toBeInTheDocument();
  });

  // 3. Error state
  it("renders an error banner when getAll fails", async () => {
    feedbackService.getAll.mockRejectedValue(new Error("Network down"));
    render(<AdminFeedbackTab />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Network down");
  });

  // 4. Empty state
  it("shows the empty feedback state when the API returns no rows", async () => {
    feedbackService.getAll.mockResolvedValue([]);
    render(<AdminFeedbackTab />);

    expect(await screen.findByText(/No Feedback Found/i)).toBeInTheDocument();
  });

  // 5. KPI cards
  it("computes KPI totals, average rating and resolution rate from the loaded data", async () => {
    feedbackService.getAll.mockResolvedValue(sampleFeedback);
    render(<AdminFeedbackTab />);
    await screen.findByText("John Doe");

    expect(screen.getByText(/Total Received/i)).toBeInTheDocument();
    // (5 + 2) / 2 = 3.5
    expect(screen.getByText("3.5")).toBeInTheDocument();
    // 1 resolved of 2 → 50%
    expect(screen.getByText(/50% resolution rate/i)).toBeInTheDocument();
  });

  // 6. Search filter
  it("filters the visible list by search query on submitter name", async () => {
    feedbackService.getAll.mockResolvedValue(sampleFeedback);
    render(<AdminFeedbackTab />);
    await screen.findByText("John Doe");

    const search = screen.getByPlaceholderText(/Search by user/i);
    fireEvent.change(search, { target: { value: "John" } });

    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.queryByText("App crashed")).not.toBeInTheDocument();
  });

  // 7. Status filter
  it("filters the visible list by status pill (RESOLVED)", async () => {
    feedbackService.getAll.mockResolvedValue(sampleFeedback);
    render(<AdminFeedbackTab />);
    await screen.findByText("John Doe");

    fireEvent.click(screen.getByRole("button", { name: /^RESOLVED$/ }));

    expect(screen.queryByText("John Doe")).not.toBeInTheDocument();
    expect(screen.getByText("Anonymous")).toBeInTheDocument();
  });

  // 8. Role filter — non-matching role produces empty state
  it("filters the list by user role from the role dropdown", async () => {
    feedbackService.getAll.mockResolvedValue(sampleFeedback);
    render(<AdminFeedbackTab />);
    await screen.findByText("John Doe");

    const roleSelect = screen.getByDisplayValue(/All Stakeholder Roles/i);
    fireEvent.change(roleSelect, { target: { value: "DOCTOR" } });

    expect(screen.queryByText("John Doe")).not.toBeInTheDocument();
    expect(screen.getByText(/No Feedback Found/i)).toBeInTheDocument();
  });

  // 9. Rating filter — only the 5-star row remains
  it("filters the list by 5-star rating option", async () => {
    feedbackService.getAll.mockResolvedValue(sampleFeedback);
    render(<AdminFeedbackTab />);
    await screen.findByText("John Doe");

    const ratingSelect = screen.getByDisplayValue(/All Ratings/i);
    fireEvent.change(ratingSelect, { target: { value: "5" } });

    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.queryByText("Anonymous")).not.toBeInTheDocument();
  });

  // 10. Review modal opens with correct data
  it("opens the review modal with the selected feedback details", async () => {
    feedbackService.getAll.mockResolvedValue(sampleFeedback);
    render(<AdminFeedbackTab />);
    await screen.findByText("John Doe");

    const reviewButtons = screen.getAllByRole("button", {
      name: /Review & Reply/i,
    });
    fireEvent.click(reviewButtons[0]);

    expect(screen.getByText(/Official Admin Reply/i)).toBeInTheDocument();
    // Email appears in both the table row and the modal — assert at least one
    expect(screen.getAllByText("john@example.com").length).toBeGreaterThan(0);
    // Message text is truncated in the table but rendered fully in the modal
    expect(
      screen.getAllByText(/Quick and professional/i).length,
    ).toBeGreaterThan(0);
  });

  // 11. Template button populates the reply textarea
  it("applies an admin reply template into the reply textarea", async () => {
    feedbackService.getAll.mockResolvedValue(sampleFeedback);
    render(<AdminFeedbackTab />);
    await screen.findByText("John Doe");

    fireEvent.click(
      screen.getAllByRole("button", { name: /Review & Reply/i })[0],
    );
    fireEvent.click(screen.getByRole("button", { name: /\+ Acknowledgment/i }));

    const textarea = screen.getByPlaceholderText(/Type official response/i);
    expect(textarea.value).toContain("Dear John Doe");
    expect(textarea.value).toContain("National Vaxora Administration");
  });

  // 12. Save resolution dispatches to service
  it("saves a resolution through feedbackService.resolve", async () => {
    feedbackService.getAll.mockResolvedValue(sampleFeedback);
    feedbackService.resolve.mockResolvedValue({});
    render(<AdminFeedbackTab />);
    await screen.findByText("John Doe");

    fireEvent.click(
      screen.getAllByRole("button", { name: /Review & Reply/i })[0],
    );

    const statusSelect = screen.getByDisplayValue(/^New \/ Unread$/);
    fireEvent.change(statusSelect, { target: { value: "Resolved" } });

    const textarea = screen.getByPlaceholderText(/Type official response/i);
    fireEvent.change(textarea, {
      target: { value: "Thanks for the feedback!" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Save & Update Resolution/i }),
    );

    await waitFor(() => {
      expect(feedbackService.resolve).toHaveBeenCalledWith(
        "fb-11111111-aaaa",
        expect.objectContaining({
          status: "Resolved",
          adminResponse: "Thanks for the feedback!",
        }),
      );
    });
  });

  // 13. Quick resolve button
  it("quick-resolves a ticket with the Resolved status", async () => {
    feedbackService.getAll.mockResolvedValue(sampleFeedback);
    feedbackService.resolve.mockResolvedValue({});
    render(<AdminFeedbackTab />);
    await screen.findByText("John Doe");

    const quickBtn = screen.getByTitle(/Quick mark as resolved/i);
    fireEvent.click(quickBtn);

    await waitFor(() => {
      expect(feedbackService.resolve).toHaveBeenCalledWith(
        "fb-11111111-aaaa",
        expect.objectContaining({ status: "Resolved" }),
      );
    });
  });

  // 14. Anonymous submissions render as "Anonymous"
  it('renders "Anonymous" for anonymous submissions', async () => {
    feedbackService.getAll.mockResolvedValue(sampleFeedback);
    render(<AdminFeedbackTab />);
    await screen.findByText("John Doe");

    expect(screen.getByText("Anonymous")).toBeInTheDocument();
  });

  // 15. Quick-resolve hidden for already-resolved rows
  it("hides the quick-resolve button for already-resolved tickets", async () => {
    feedbackService.getAll.mockResolvedValue([sampleFeedback[1]]);
    render(<AdminFeedbackTab />);
    await screen.findByText("Anonymous");

    expect(
      screen.queryByTitle(/Quick mark as resolved/i),
    ).not.toBeInTheDocument();
  });
});
