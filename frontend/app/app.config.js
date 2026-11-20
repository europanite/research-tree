// Expo's normal app.json is retained from the template; this supplements it
// so assets and public/embed-worker.js resolve inside a GitHub Pages subpath.
module.exports = ({config}) => {
  const repo = process.env.GITHUB_REPOSITORY?.split('/')[1];
  const configured = process.env.EXPO_PUBLIC_BASE_PATH;
  const base = configured !== undefined ? configured : (repo ? '/' + repo : '');
  return {
    ...config,
    experiments: {...config.experiments, baseUrl: base},
  };
};
