import UserSettings from '@app/components/UserProfile/UserSettings';
import UserParentalSettings from '@app/components/UserProfile/UserSettings/UserParentalSettings';
import useRouteGuard from '@app/hooks/useRouteGuard';
import { Permission } from '@app/hooks/useUser';
import type { NextPage } from 'next';

const UserParentalSettingsPage: NextPage = () => {
  useRouteGuard(Permission.MANAGE_USERS);
  return (
    <UserSettings>
      <UserParentalSettings />
    </UserSettings>
  );
};

export default UserParentalSettingsPage;
