import java.sql.Connection;
import java.sql.DriverManager;

public class TestOracle {
    public static void main(String[] args) {
        String[] urls = new String[]{
            "jdbc:oracle:thin:@//aslx370br.natura.com.br:1521/o02hm",
            "jdbc:oracle:thin:@aslx370br.natura.com.br:1521:o02hm",
            "jdbc:oracle:thin:@//aslx370br.natura.com.br:1521/O02HM",
            "jdbc:oracle:thin:@aslx370br.natura.com.br:1521:O02HM"
        };
        for (String url : urls) {
            try {
                System.out.println("Testing URL: " + url);
                Connection conn = DriverManager.getConnection(url, "proccad", "s3nha_2009");
                System.out.println("SUCCESSFULLY CONNECTED VIA JDBC with URL: " + url);
                conn.close();
                return;
            } catch (Exception e) {
                System.out.println("  Result: " + e.getMessage());
            }
        }
    }
}
