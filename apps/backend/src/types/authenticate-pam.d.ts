declare module "authenticate-pam" {
  const pam: {
    authenticate: (
      username: string,
      password: string,
      callback: (err?: unknown) => void
    ) => void;
  };
  export default pam;
}

