import TvDetails from '@app/components/TvDetails';
import { getHostAndPort } from '@app/utils/urlHelper';
import type { TvDetails as TvDetailsType } from '@server/models/Tv';
import axios from 'axios';
import type { GetServerSideProps, NextPage } from 'next';

interface TvPageProps {
  tv?: TvDetailsType;
}

const TvPage: NextPage<TvPageProps> = ({ tv }) => {
  return <TvDetails tv={tv} />;
};

export const getServerSideProps: GetServerSideProps<TvPageProps> = async (
  ctx
) => {
  try {
    const response = await axios.get<TvDetailsType>(
      `http://${getHostAndPort()}/api/v1/tv/${ctx.query.tvId}`,
      {
        headers: ctx.req?.headers?.cookie
          ? { cookie: ctx.req.headers.cookie }
          : undefined,
      }
    );

    return {
      props: {
        tv: response.data,
      },
    };
  } catch (err) {
    if (
      axios.isAxiosError(err) &&
      (err.response?.status === 403 || err.response?.status === 404)
    ) {
      return { notFound: true };
    }

    throw err;
  }
};

export default TvPage;
