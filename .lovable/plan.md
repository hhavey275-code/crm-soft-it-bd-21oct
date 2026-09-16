# External Top-Up menu and live badge

## Changes
- Add a dedicated **External Top-Up** item directly below **Business Managers** and above **Top-Up Request** in the admin sidebar.
- Open the existing External Top-Up request screen from that item without changing its approval/top-up workflow.
- Show pending External Top-Up requests on that menu item with a distinct orange badge.
- Update the badge immediately through the existing live database subscription, without requiring a reload.
- Keep the general **Requests** badge for the other request categories so External Top-Up is not counted twice.

## Technical details
- Add a dedicated route and reuse the existing `AdminExternalTopUpRequests` screen.
- Give External Top-Up its own sidebar permission key while preserving access for admins who already have Requests access.
- Split `external_topup_requests` into its own badge count and update it immediately on live insert/update/delete events; retain a short reconciliation fetch for correctness.
- Verify the new route metadata, sidebar placement, badge color, live update handling, and current build status.
