import { expect, test } from 'tappet';

test('the signed-out home screen offers a way in', async ({ app }) => {
  await expect(app.getByRole('text', { name: 'Welcome' })).toHaveText('Welcome', { exact: true });
  await expect(app.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  await expect(app.getByTestId('greeting')).not.toBeVisible();
});
