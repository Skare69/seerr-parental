import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import useToasts from '@app/hooks/useToasts';
import { useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import { Label, Radio, RadioGroup } from '@headlessui/react';
import { ArrowDownOnSquareIcon } from '@heroicons/react/24/outline';
import type { TmdbGenre } from '@server/api/themoviedb/interfaces';
import type { UserSettingsParentalResponse } from '@server/interfaces/api/userSettingsInterfaces';
import { fskFromDob } from '@server/lib/fskAge';
import axios from 'axios';
import { Form, Formik } from 'formik';
import { useRouter } from 'next/router';
import type { MessageDescriptor } from 'react-intl';
import { useIntl } from 'react-intl';
import Select from 'react-select';
import useSWR from 'swr';

const messages = defineMessages(
  'components.UserProfile.UserSettings.UserParentalSettings',
  {
    parentalControls: 'Parental Controls',
    description:
      'Choose how this user’s age limit is set. A date of birth keeps itself current; a fixed rating never changes on its own.',
    limitSource: 'Age Limit',
    limitSourceNone: 'Unrestricted',
    limitSourceNoneTip: 'No titles are hidden for this user',
    limitSourceDob: 'From date of birth',
    limitSourceDobTip:
      'Derived from the age and raised automatically at each birthday',
    limitSourceFixed: 'Fixed rating',
    limitSourceFixedTip: 'Stays where you set it until you change it',
    limitSourceTip:
      'Titles above the resulting rating are hidden in discovery and search, and requests for them are refused',
    dateofbirth: 'Date of Birth',
    maxagerating: 'Maximum Age Rating',
    currentlimit: 'Current limit',
    currentlimitUnrestricted: 'Unrestricted — no titles are hidden',
    blockedgenres: 'Blocked Genres',
    blockedgenresTip:
      'Titles in these genres are hidden and cannot be requested, whatever their age rating',
    selectgenres: 'Select genres…',
    currentlimitValue: 'FSK {rating} — higher-rated titles are hidden',
    toastSettingsSuccess: 'Parental controls saved successfully!',
    toastSettingsFailure: 'Something went wrong while saving settings.',
  }
);

type LimitSource = 'none' | 'dob' | 'fixed';

const LIMIT_SOURCES: {
  value: LimitSource;
  label: MessageDescriptor;
  tip: MessageDescriptor;
}[] = [
  {
    value: 'none',
    label: messages.limitSourceNone,
    tip: messages.limitSourceNoneTip,
  },
  {
    value: 'dob',
    label: messages.limitSourceDob,
    tip: messages.limitSourceDobTip,
  },
  {
    value: 'fixed',
    label: messages.limitSourceFixed,
    tip: messages.limitSourceFixedTip,
  },
];

const FSK_TIERS = [0, 6, 12, 16, 18];

/** Sensible starting point when switching to a hand-picked rating. */
const DEFAULT_FIXED_RATING = '12';

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

  // Movie and TV genre ids share one space, so one blocklist covers both;
  // the two lists differ though (War 10752 vs War & Politics 10768).
  const { data: movieGenres } = useSWR<TmdbGenre[]>('/api/v1/genres/movie');
  const { data: tvGenres } = useSWR<TmdbGenre[]>('/api/v1/genres/tv');

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

  const genreOptions = [...(movieGenres ?? []), ...(tvGenres ?? [])]
    .filter((genre, i, all) => all.findIndex((g) => g.id === genre.id) === i)
    .map((genre) => ({ label: genre.name, value: genre.id }))
    .sort((a, b) => a.label.localeCompare(b.label));

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
        <p className="description">
          {intl.formatMessage(messages.description)}
        </p>
      </div>
      <Formik
        initialValues={{
          limitSource: initialSource,
          dateOfBirth: data.dateOfBirth ?? '',
          maxParentalRating:
            data.maxParentalRating != null
              ? String(data.maxParentalRating)
              : '',
          blockedGenres: data.blockedGenres ?? [],
        }}
        enableReinitialize
        onSubmit={async (values) => {
          // Exactly one age limit is ever sent: the two are alternatives,
          // never a combination. The genre blocklist is independent of both.
          const limits =
            values.limitSource === 'dob'
              ? {
                  dateOfBirth: values.dateOfBirth || null,
                  maxParentalRating: null,
                }
              : values.limitSource === 'fixed'
                ? {
                    dateOfBirth: null,
                    maxParentalRating:
                      values.maxParentalRating === ''
                        ? null
                        : Number(values.maxParentalRating),
                  }
                : { dateOfBirth: null, maxParentalRating: null };
          const payload = { ...limits, blockedGenres: values.blockedGenres };

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
              : values.limitSource === 'fixed' &&
                  values.maxParentalRating !== ''
                ? Number(values.maxParentalRating)
                : null;

          return (
            <Form className="section">
              <div className="form-row">
                <span className="text-label">
                  {intl.formatMessage(messages.limitSource)}
                  <span className="label-tip">
                    {intl.formatMessage(messages.limitSourceTip)}
                  </span>
                </span>
                <div className="form-input-area">
                  <RadioGroup
                    value={values.limitSource}
                    onChange={(next: LimitSource) => {
                      setFieldValue('limitSource', next);
                      if (next === 'fixed' && values.maxParentalRating === '') {
                        setFieldValue(
                          'maxParentalRating',
                          DEFAULT_FIXED_RATING
                        );
                      }
                    }}
                  >
                    <Label className="sr-only">
                      {intl.formatMessage(messages.limitSource)}
                    </Label>
                    <div className="-space-y-px overflow-hidden rounded-md bg-gray-800/30">
                      {LIMIT_SOURCES.map((option, index) => (
                        <Radio
                          key={option.value}
                          as="div"
                          value={option.value}
                          className={({ checked }) =>
                            `${index === 0 ? 'rounded-t-md' : ''} ${
                              index === LIMIT_SOURCES.length - 1
                                ? 'rounded-b-md'
                                : ''
                            } ${
                              checked
                                ? 'z-10 border border-indigo-500 bg-indigo-400/20'
                                : 'border-gray-500'
                            } relative flex cursor-pointer border p-4 focus:outline-none`
                          }
                        >
                          {({ focus, checked }) => (
                            <>
                              <span
                                className={`${
                                  checked
                                    ? 'border-transparent bg-indigo-600'
                                    : 'border-gray-300 bg-white'
                                } ${
                                  focus
                                    ? 'ring-2 ring-indigo-300 ring-offset-2'
                                    : ''
                                } mt-0.5 flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-full border`}
                                aria-hidden="true"
                              >
                                <span className="h-1.5 w-1.5 rounded-full bg-white" />
                              </span>
                              <div className="ml-3 flex flex-col">
                                <Label
                                  as="span"
                                  className={`block text-sm font-medium ${
                                    checked
                                      ? 'text-indigo-100'
                                      : 'text-gray-100'
                                  }`}
                                >
                                  {intl.formatMessage(option.label)}
                                </Label>
                                <span className="block text-xs text-gray-400">
                                  {intl.formatMessage(option.tip)}
                                </span>
                              </div>
                            </>
                          )}
                        </Radio>
                      ))}
                    </div>
                  </RadioGroup>
                </div>
              </div>

              {values.limitSource === 'dob' && (
                <div className="form-row">
                  <label htmlFor="dateOfBirth" className="text-label">
                    <span>{intl.formatMessage(messages.dateofbirth)}</span>
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

              <div className="form-row">
                <label htmlFor="blockedGenres" className="text-label">
                  <span>{intl.formatMessage(messages.blockedgenres)}</span>
                  <span className="label-tip">
                    {intl.formatMessage(messages.blockedgenresTip)}
                  </span>
                </label>
                <div className="form-input-area">
                  <Select
                    inputId="blockedGenres"
                    className="react-select-container"
                    classNamePrefix="react-select"
                    isMulti
                    options={genreOptions}
                    value={genreOptions.filter((option) =>
                      values.blockedGenres.includes(option.value)
                    )}
                    onChange={(selected) =>
                      setFieldValue(
                        'blockedGenres',
                        selected.map((option) => option.value)
                      )
                    }
                    placeholder={intl.formatMessage(messages.selectgenres)}
                  />
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
