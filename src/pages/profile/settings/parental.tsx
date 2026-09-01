import UserSettings from '@app/components/UserProfile/UserSettings';
import UserParentalSettings from '@app/components/UserProfile/UserSettings/UserParentalSettings';
import type { NextPage } from 'next';

const UserParentalSettingsPage: NextPage = () => {
  return (
    <UserSettings>
      <UserParentalSettings />
    </UserSettings>
  );
};

export default UserParentalSettingsPage;
