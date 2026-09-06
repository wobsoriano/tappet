import { expect, test } from 'tappet';

test('a test can leave the app signed in on the profile', async ({ app }) => {
  await app.getByTestId('sign-in-link').tap();
  await app.getByTestId('email').fill('rob@example.com');
  await app.getByTestId('password').fill('hunter2');
  await app.getByRole('button', { name: 'Sign in' }).tap();

  await expect(app.getByTestId('profile-name')).toBeVisible();
});

test('the next test still starts signed out', async ({ app }) => {
  await expect(app.getByText('Welcome')).toBeVisible();
  await expect(app.getByTestId('greeting')).not.toBeVisible();
});
