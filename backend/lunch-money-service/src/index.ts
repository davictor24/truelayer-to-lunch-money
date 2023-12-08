import express, { Request, Response } from 'express';

const app = express();
const port = 8081;

app.get('/', (_: Request, res: Response) => {
  res.send('Hello world');
});

app.listen(port, () => {
  console.log(`Server started at port ${port}`);
});
