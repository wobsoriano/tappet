import { expect, test } from 'tappet';

test('the wrong password is rejected without leaving the login screen', async ({ app }) => {
  await app.getByTestId('sign-in-link').tap();
  await app.getByRole('text-field', { name: 'Email' }).fill('rob@example.com');
  await app.getByTestId('password').fill('wrong');
  await app.getByRole('button', { name: 'Sign in' }).tap();

  await expect(app.getByTestId('error')).toHaveText('Wrong email or password', { exact: true });
  await expect(app.getByTestId('profile-name')).not.toBeVisible();
});

test('the right credentials land on the profile after the sign-in wait', async ({ app }) => {
  await app.getByTestId('sign-in-link').tap();
  await app.getByRole('text-field').first().fill('rob@example.com');
  await expect(app.getByRole('text-field').first()).toHaveValue('rob@example.com');

  await app.getByTestId('password').fill('hunter2');
  await app.getByRole('button', { name: 'Sign in' }).tap();

  await expect(app.getByTestId('signing-in')).toBeVisible();
  await expect(app.getByRole('button', { name: 'Sign in' })).not.toBeEnabled();

  await expect(app.getByRole('text', { name: 'Rob', exact: true })).toHaveText('Rob', {
    exact: true,
  });
  await expect(app.getByTestId('profile-email')).toHaveText('rob@example.com', { exact: true });
});
