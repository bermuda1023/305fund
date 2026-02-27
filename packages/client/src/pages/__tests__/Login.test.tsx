import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Login from '../Login';

const navigateMock = vi.fn();
const loginMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('../../lib/auth', () => ({
  useAuth: () => ({
    login: loginMock,
  }),
}));

describe('Login page', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    loginMock.mockReset();
  });

  it('submits credentials and navigates to GP dashboard', async () => {
    loginMock.mockResolvedValue({
      role: 'gp',
      mustChangePassword: false,
    });
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );

    await userEvent.type(screen.getByPlaceholderText(/you@example.com or admin/i), 'admin');
    await userEvent.type(screen.getByPlaceholderText(/Enter your password/i), 'admin');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(loginMock).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith('/app/dashboard');
  });

  it('shows API error message when login fails', async () => {
    loginMock.mockRejectedValue({
      response: { data: { error: 'Invalid credentials' } },
    });
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );

    await userEvent.type(screen.getByPlaceholderText(/you@example.com or admin/i), 'bad');
    await userEvent.type(screen.getByPlaceholderText(/Enter your password/i), 'bad');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/Invalid credentials/i)).toBeInTheDocument();
  });
});

