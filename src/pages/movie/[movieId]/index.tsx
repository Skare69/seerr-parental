import MovieDetails from '@app/components/MovieDetails';
import { getHostAndPort } from '@app/utils/urlHelper';
import type { MovieDetails as MovieDetailsType } from '@server/models/Movie';
import axios from 'axios';
import type { GetServerSideProps, NextPage } from 'next';

interface MoviePageProps {
  movie?: MovieDetailsType;
}

const MoviePage: NextPage<MoviePageProps> = ({ movie }) => {
  return <MovieDetails movie={movie} />;
};

export const getServerSideProps: GetServerSideProps<MoviePageProps> = async (
  ctx
) => {
  try {
    const response = await axios.get<MovieDetailsType>(
      `http://${getHostAndPort()}/api/v1/movie/${ctx.query.movieId}`,
      {
        headers: ctx.req?.headers?.cookie
          ? { cookie: ctx.req.headers.cookie }
          : undefined,
      }
    );

    return {
      props: {
        movie: response.data,
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

export default MoviePage;
