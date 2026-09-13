import { render, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { initialProjects } from '../mockData';
import { DeleteProjectModal } from './DeleteProjectModal';

// Queries are scoped via `within(container)` rather than the global `screen`,
// since this suite has no afterEach(cleanup) and each test's render() stays
// mounted in the shared document — an unscoped query would match buttons
// left over from earlier tests too.
function renderOpen(onConfirmDelete = vi.fn(), onClose = vi.fn()) {
  const { container } = render(
    <DeleteProjectModal project={initialProjects[0]} isOpen onClose={onClose} onConfirmDelete={onConfirmDelete} />,
  );
  return { container, onConfirmDelete, onClose };
}

test('returns null when closed', () => {
  const { container } = render(
    <DeleteProjectModal project={initialProjects[0]} isOpen={false} onClose={vi.fn()} onConfirmDelete={vi.fn()} />,
  );
  expect(container).toBeEmptyDOMElement();
});

test('shows the project name when open', () => {
  const { container } = renderOpen();
  expect(within(container).getByText(new RegExp(initialProjects[0].name))).toBeVisible();
});

test('clicking confirm calls onConfirmDelete with the project id, then closes', async () => {
  const user = userEvent.setup();
  const { container, onConfirmDelete, onClose } = renderOpen();
  await user.click(within(container).getByRole('button', { name: '確定刪除' }));
  expect(onConfirmDelete).toHaveBeenCalledWith(initialProjects[0].id);
  expect(onClose).toHaveBeenCalled();
});

test('clicking cancel closes without deleting', async () => {
  const user = userEvent.setup();
  const { container, onConfirmDelete, onClose } = renderOpen();
  await user.click(within(container).getByRole('button', { name: '取消' }));
  expect(onConfirmDelete).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});
