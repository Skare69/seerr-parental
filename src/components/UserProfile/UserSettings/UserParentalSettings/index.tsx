import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import useToasts from '@app/hooks/useToasts';
import { useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import { ArrowDownOnSquareIcon } from '@heroicons/react/24/outline';
import type { UserSettingsParentalResponse } from '@server/interfaces/api/userSettingsInterfaces';
import { fskFromDob } from '@server/lib/fskAge';
import axios from 'axios';
import { Form, Formik } from 'formik';
import { useRouter } from 'next/router';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages(
  'components.UserProfile.UserSettings.UserParentalSettings',
  {
    parentalControls: 'Parental Controls',
    description:
      'Choose how this user\u2019s age limit is set. A date of birth keeps itself current; a fixed rating never changes on its own.',
    limitSource: 'Age Limit',
    limitSourceNone: 'Unrestricted',
    limitSourceDob: 'From date of birth',
    limitSourceFixed: 'Fixed rating',
    limitSourceTip:
      'Titles above the resulting rating are hidden in discovery and search, and requests for them are refused',
    dateofbirth: 'Date of Birth',
    dateofbirthTip:
      'The limit follows the age and rises automatically at each birthday',
    maxagerating: 'Maximum Age Rating',
    currentlimit: 'Current limit',
    currentlimitUnrestricted: 'Unrestricted \u2014 no titles are hidden',
    currentlimitValue: 'FSK {rating} \u2014 higher-rated titles are hidden',
    toastSettingsSuccess: 'Parental controls saved successfully!',
    toastSettingsFailure: 'Something went wrong while saving settings.',
  }
);

type LimitSource = 'none' | 'dob' | 'fixed';

const FSK_TIERS = [0, 6, 12, 16, 18];

const UserParentalSettings = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const router = useRouter();
  const { user, revalidate: revalidateUser } = useUser({
    id: Number(router.query.userId),
  });
  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<UserSettingsParentalResponse>(
    user ? `/api/v1/user/${user.id}/settings/parental` : null
  );

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  if (!data) {
    return <ErrorPage statusCode={500} />;
  }

  const initialSource: LimitSource = data.dateOfBirth
    ? 'dob'
    : data.maxParentalRating != null
      ? 'fixed'
      : 'none';

  return (
    <>
      <PageTitle
        title={[
          intl.formatMessage(messages.parentalControls),
          intl.formatMessage(globalMessages.usersettings),
          user?.displayName,
        ]}
      />
      <div className="mb-6">
        <h3 className="heading">
          {intl.formatMessage(messages.parentalControls)}
        </h3>
        <p className="description">{intl.formatMessage(messages.description)}</p>
      </div>
      <Formik
        initialValues={{
          limitSource: initialSource,
          dateOfBirth: data.dateOfBirth ?? '',
          maxParentalRating:
            data.maxParentalRating != null ? String(data.maxParentalRating) : '',
        }}
        enableReinitialize
        onSubmit={async (values) => {
          // Exactly one field is ever sent: the two limits are alternatives,
          // never a combination. The server applies the same rule.
          const payload =
            values.limitSource === 'dob'
              ? { dateOfBirth: values.dateOfBirth || null, maxParentalRating: null }
              : values.limitSource === 'fixed'
                ? {
                    dateOfBirth: null,
                    maxParentalRating:
                      values.maxParentalRating === ''
                        ? null
                        : Number(values.maxParentalRating),
                  }
                : { dateOfBirth: null, maxParentalRating: null };

          try {
            await axios.post(
              `/api/v1/user/${user?.id}/settings/parental`,
              payload
            );

            addToast(intl.formatMessage(messages.toastSettingsSuccess), {
              autoDismiss: true,
              appearance: 'success',
            });
          } catch {
            addToast(intl.formatMessage(messages.toastSettingsFailure), {
              autoDismiss: true,
              appearance: 'error',
            });
          } finally {
            revalidate();
            revalidateUser();
          }
        }}
      >
        {({ isSubmitting, setFieldValue, values }) => {
          const effective =
            values.limitSource === 'dob'
              ? fskFromDob(values.dateOfBirth)
              : values.limitSource === 'fixed' && values.maxParentalRating !== ''
                ? Number(values.maxParentalRating)
                : null;

          return (
            <Form className="section">
              <div className="form-row">
                <label htmlFor="limitSource" className="text-label">
                  <span>{intl.formatMessage(messages.limitSource)}</span>
                  <span className="label-tip">
                    {intl.formatMessage(messages.limitSourceTip)}
                  </span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <select
                      id="limitSource"
                      name="limitSource"
                      value={values.limitSource}
                      onChange={(e) =>
                        setFieldValue('limitSource', e.target.value)
                      }
                    >
                      <option value="none">
                        {intl.formatMessage(messages.limitSourceNone)}
                      </option>
                      <option value="dob">
                        {intl.formatMessage(messages.limitSourceDob)}
                      </option>
                      <option value="fixed">
                        {intl.formatMessage(messages.limitSourceFixed)}
                      </option>
                    </select>
                  </div>
                </div>
              </div>

              {values.limitSource === 'dob' && (
                <div className="form-row">
                  <label htmlFor="dateOfBirth" className="text-label">
                    <span>{intl.formatMessage(messages.dateofbirth)}</span>
                    <span className="label-tip">
                      {intl.formatMessage(messages.dateofbirthTip)}
                    </span>
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <input
                        type="date"
                        id="dateOfBirth"
                        name="dateOfBirth"
                        value={values.dateOfBirth}
                        onChange={(e) =>
                          setFieldValue('dateOfBirth', e.target.value)
                        }
                      />
                    </div>
                  </div>
                </div>
              )}

              {values.limitSource === 'fixed' && (
                <div className="form-row">
                  <label htmlFor="maxParentalRating" className="text-label">
                    <span>{intl.formatMessage(messages.maxagerating)}</span>
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <select
                        id="maxParentalRating"
                        name="maxParentalRating"
                        value={values.maxParentalRating}
                        onChange={(e) =>
                          setFieldValue('maxParentalRating', e.target.value)
                        }
                      >
                        <option value="">
                          {intl.formatMessage(messages.limitSourceNone)}
                        </option>
                        {FSK_TIERS.map((rating) => (
                          <option value={rating} key={`rating-${rating}`}>
                            {`FSK ${rating}`}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              <div className="form-row">
                <span className="text-label">
                  {intl.formatMessage(messages.currentlimit)}
                </span>
                <div className="form-input-area">
                  <span className="text-sm text-gray-300">
                    {effective === null
                      ? intl.formatMessage(messages.currentlimitUnrestricted)
                      : intl.formatMessage(messages.currentlimitValue, {
                          rating: effective,
                        })}
                  </span>
                </div>
              </div>

              <div className="actions">
                <div className="flex justify-end">
                  <span className="ml-3 inline-flex rounded-md shadow-sm">
                    <Button
                      buttonType="primary"
                      type="submit"
                      disabled={isSubmitting}
                    >
                      <ArrowDownOnSquareIcon />
                      <span>
                        {isSubmitting
                          ? intl.formatMessage(globalMessages.saving)
                          : intl.formatMessage(globalMessages.save)}
                      </span>
                    </Button>
                  </span>
                </div>
              </div>
            </Form>
          );
        }}
      </Formik>
    </>
  );
};

export default UserParentalSettings;
